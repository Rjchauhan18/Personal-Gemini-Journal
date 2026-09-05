import { reflectSystemPrompt } from './src/reflect-prompt.js';
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fsSync from 'fs';
const firebaseConfig = JSON.parse(fsSync.readFileSync('./firebase-applet-config.json', 'utf8'));
import Redis from 'ioredis';
import crypto from 'crypto';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { OAuth2Client } from 'google-auth-library';
import nodemailer from 'nodemailer';
import { v2 as cloudinary } from 'cloudinary';

// Initialize Firebase Admin for token verification and Firestore DB operations
if (getApps().length === 0) {
  initializeApp({ projectId: firebaseConfig.projectId }); 
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const modelRateLimits = new Map<string, number>();
const db = getFirestore(getApps()[0], firebaseConfig.firestoreDatabaseId || '(default)');

// Setup Google Cloud Secret Manager client
const secretClient = new SecretManagerServiceClient();

async function accessSecret(secretName: string) {
  const envKey = secretName.split('/').slice(-3)[0];
  if (process.env[envKey]) return process.env[envKey];
  if (process.env[secretName]) return process.env[secretName];

  // Try retrieving via Secret Manager. Formats like: projects/PROJECT_ID/secrets/SECRET_NAME/versions/latest
  try {
     const [version] = await secretClient.accessSecretVersion({ name: secretName });
     return version.payload?.data?.toString() || '';
  } catch (e) {
     // Fallback for local AI Studio environment where GCP credentials might not be present or mapped
     return '';
  }
}

// OIDC Verification Client for Cron jobs
const oAuth2Client = new OAuth2Client();

// Set up Redis client (fallback to memory if unavailable in environment)
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  retryStrategy(times) {
    if (times > 3) return null; // stop retrying
    return Math.min(times * 50, 2000);
  }
});
redis.on('error', (err) => {
  console.warn('Redis connection error (cache may be unavailable):', err.message);
});

// Fallback in-memory cache if Redis is down
const memoryCache = new Map<string, {value: string, expiry: number}>();
async function getCache(key: string): Promise<string | null> {
  if (redis.status === 'ready') {
    return await redis.get(key);
  }
  const item = memoryCache.get(key);
  if (item && item.expiry > Date.now()) return item.value;
  if (item) memoryCache.delete(key);
  return null;
}
async function setCache(key: string, value: string, ttlSeconds: number) {
  if (redis.status === 'ready') {
    await redis.set(key, value, 'EX', ttlSeconds);
  } else {
    memoryCache.set(key, { value, expiry: Date.now() + ttlSeconds * 1000 });
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Middleware to verify Firebase token for client requests
  const authenticateToken = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
       res.status(401).json({ error: 'Unauthorized: No header provided' });
       return;
    }

    const token = authHeader.split('Bearer ')[1];
    if (!token || token === 'undefined' || token === 'null') {
      res.status(401).json({ error: 'Unauthorized: Invalid token format' });
      return;
    }
    
    try {
      const decodedToken = await getAuth().verifyIdToken(token);
      (req as any).user = decodedToken;
      next();
    } catch (err: any) {
      console.error('Token verification error:', err.message || err);
      res.status(401).json({ error: 'Unauthorized', details: err.message || String(err) });
    }
  };

  // Middleware to verify OIDC token for Google Cloud Scheduler
  const verifyCronOIDC = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized Cron Invocation: Missing token' });
      return;
    }
    const token = authHeader.split('Bearer ')[1];

    // 1. External Cron Secret (For GitHub Actions or cron-job.org)
    const CRON_SECRET = await accessSecret('projects/sound-beaker-g8chg/secrets/CRON_SECRET/versions/latest') || process.env.CRON_SECRET || "HACKATHON_REFLECT_SECRET_2026";
    if (token === CRON_SECRET) {
      return next();
    }

    // 2. Google Cloud OIDC check
    try {
      const ticket = await oAuth2Client.verifyIdToken({
         idToken: token,
      });
      (req as any).cronApp = ticket.getPayload();
      next();
    } catch (e) {
      console.error('Cron OIDC verification error:', e);
      res.status(401).json({ error: 'Unauthorized Cron Invocation: Invalid OIDC token' });
    }
  };

  async function generateContentWithFallback(contents: any, jsonMode = false) {
    const models = [
      "gemini-3.6-flash",
      "gemini-3.1-flash-lite",
      "gemini-flash-latest",
      "gemini-3.7-flash"
    ];
    
    for (const model of models) {
      if (modelRateLimits.has(model)) {
        const resetTime = modelRateLimits.get(model)!;
        if (Date.now() < resetTime) {
          console.log(`Skipping ${model} due to active rate limit until ${new Date(resetTime).toLocaleTimeString()}`);
          continue;
        } else {
          modelRateLimits.delete(model);
        }
      }
      try {
        const config: any = {};
        if (jsonMode) {
          config.responseMimeType = "application/json";
        }
        const response = await ai.models.generateContent({
          model: model,
          contents: contents,
          config: config
        });
        return response.text;
      } catch (error: any) {
        // Suppress raw error if recoverable, handle below
        const errStr = String(error);
        const status = error?.status || error?.response?.status || error?.error?.code;
        if (
          status === 503 || status === 429 || status === 404 || status === 500 ||
          errStr.includes('503') || errStr.includes('429') || errStr.includes('404') || errStr.includes('500') ||
          errStr.includes('UNAVAILABLE') || errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('NOT_FOUND') ||
          errStr.includes('fetch failed') || errStr.includes('Timeout') || errStr.includes('timeout') || errStr.includes('ECONNRESET') || errStr.includes('ETIMEDOUT')
        ) {
          if (status === 429 || errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED')) {
             // Parse the "retry in Xs" from error if present
             const match = errStr.match(/retry in ([0-9.]+)s/);
             const retrySecs = match ? parseFloat(match[1]) : 60;
             modelRateLimits.set(model, Date.now() + (retrySecs * 1000));
          }
          console.warn(`Recoverable error (${status || 'network'}) with ${model}. Skipping to next fallback model...`);
          // Note: if it's a daily quota limit, pausing doesn't help. We should just try the next model.
          continue;
        }
        throw error; // Unrecoverable error
      }
    }
    throw new Error("All fallback models failed.");
  }

  async function generateStreamWithFallback(contents: any) {
    const models = [
      "gemini-3.6-flash",
      "gemini-3.1-flash-lite",
      "gemini-flash-latest",
      "gemini-3.7-flash"
    ];
    
    for (const model of models) {
      if (modelRateLimits.has(model)) {
        const resetTime = modelRateLimits.get(model)!;
        if (Date.now() < resetTime) {
          console.log(`Skipping ${model} due to active rate limit until ${new Date(resetTime).toLocaleTimeString()}`);
          continue;
        } else {
          modelRateLimits.delete(model);
        }
      }
      try {
        const response = await ai.models.generateContentStream({
          model: model,
          contents: contents,
        });
        
        // Peek at the first chunk to trigger any immediate rate limit errors
        const iterator = response[Symbol.asyncIterator]();
        const firstResult = await iterator.next();
        
        async function* wrappedStream() {
          if (!firstResult.done) {
            yield firstResult.value;
            yield* iterator;
          }
        }
        return wrappedStream();
      } catch (error: any) {
        console.error(`Gemini API Error with model ${model} during stream init:`, error);
        const errStr = String(error);
        const status = error?.status || error?.response?.status || error?.error?.code;
        if (
          status === 503 || status === 429 || status === 404 || status === 500 ||
          errStr.includes('503') || errStr.includes('429') || errStr.includes('404') || errStr.includes('500') ||
          errStr.includes('UNAVAILABLE') || errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('NOT_FOUND') ||
          errStr.includes('fetch failed') || errStr.includes('Timeout') || errStr.includes('timeout') || errStr.includes('ECONNRESET') || errStr.includes('ETIMEDOUT')
        ) {
          console.warn(`Recoverable stream error with ${model}, trying next immediately...`);
          continue;
        }
        throw error;
      }
    }
    throw new Error("All fallback models failed.");
  }

  // API to generate reply
  
  // Cloudinary image upload endpoint
  app.post("/api/upload", authenticateToken, async (req: express.Request, res: express.Response) => {
    try {
      const data = req.body;
      const { images } = data; // expects an array of base64 strings
      
      if (!images || !Array.isArray(images) || images.length === 0) {
        res.status(400).json({ error: 'No images provided' });
        return;
      }
      
      const apiKey = await accessSecret('projects/sound-beaker-g8chg/secrets/CLOUDINARY_API_KEY/versions/latest') || process.env.CLOUDINARY_API_KEY;
      const apiSecret = await accessSecret('projects/sound-beaker-g8chg/secrets/CLOUDINARY_API_SECRET/versions/latest') || process.env.CLOUDINARY_API_SECRET;
      const cloudName = await accessSecret('projects/sound-beaker-g8chg/secrets/CLOUDINARY_CLOUD_NAME/versions/latest') || process.env.CLOUDINARY_CLOUD_NAME || 'placeholder_cloud_name';
      
      if (!apiKey || !apiSecret) {
        res.status(500).json({ error: 'Cloudinary credentials are not configured on the server.' });
        return;
      }

      cloudinary.config({ 
        cloud_name: cloudName, 
        api_key: apiKey, 
        api_secret: apiSecret 
      });

      const uploadPromises = images.map(async (base64Str) => {
        return new Promise<string>((resolve, reject) => {
          cloudinary.uploader.upload(base64Str, { folder: 'reflect_ai_journal' }, (error, result) => {
            if (error) {
              console.error('Cloudinary upload error:', error);
              reject(error);
            } else if (result) {
              resolve(result.secure_url);
            } else {
              reject(new Error('Unknown upload error'));
            }
          });
        });
      });

      const uploadedUrls = await Promise.all(uploadPromises);
      res.json({ urls: uploadedUrls });
    } catch (err: any) {
      console.error('Error in /api/upload:', err);
      res.status(500).json({ error: err.message || 'Failed to upload images' });
    }
  });

  app.post("/api/chat", authenticateToken, async (req: express.Request, res: express.Response) => {
    try {
      const data = (req.body && typeof req.body === 'object') ? req.body : {};
      const { prompt, history } = data;
      
      const { images } = data;
      if (!prompt && (!images || images.length === 0)) {
        res.status(400).json({ error: 'Prompt or images required' });
        return;
      }
      
      const contents = history ? history.map((msg: any) => {
        const parts = [];
        if (msg.content && msg.content.trim() !== '') {
           parts.push({ text: msg.content });
        } else {
           parts.push({ text: " " });
        }
        if (msg.images && Array.isArray(msg.images)) {
          msg.images.forEach((imgBase64) => {
            const matches = imgBase64.match(/^data:([^;]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
              parts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
            }
          });
        }
        return { role: msg.role === 'user' ? 'user' : 'model', parts };
      }) : [];

      const currentParts = [];
      if (prompt && prompt.trim() !== '') {
         currentParts.push({ text: prompt });
      } else {
         currentParts.push({ text: " " });
      }
      if (images && Array.isArray(images)) {
        images.forEach((imgBase64) => {
           const matches = imgBase64.match(/^data:([^;]+);base64,(.+)$/);
           if (matches && matches.length === 3) {
             currentParts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
           }
        });
      }
      contents.push({ role: 'user', parts: currentParts });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const stream = await generateStreamWithFallback(contents);

      for await (const chunk of stream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error: any) {
      console.error("Chat Error:", error);
      res.write(`data: ${JSON.stringify({ error: "Failed to generate AI response." })}\n\n`);
      res.end();
    }
  });

  // API to summarize journal entry
  app.post("/api/summarize", authenticateToken, async (req: express.Request, res: express.Response) => {
    try {
      const data = (req.body && typeof req.body === 'object') ? req.body : {};
      const { messages } = data;
      
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'Messages are required' });
        return;
      }

      const textToSummarize = messages.map((m: any) => `${m.role}: ${m.content}`).join('\n');

      const prompt = `Please summarize the following journal entry and provide a thoughtful reflection or action item based on it. Keep the summary concise (under 200 words).
Also, provide a short 3-5 word title that captures the core topic of the entry.
Return ONLY a valid JSON object with the exact keys "title" and "summary". Do not include markdown formatting like \`\`\`json.

Entry:
${textToSummarize}`;

      // Check cache first
      const cacheKey = `summary:${crypto.createHash('sha256').update(prompt).digest('hex')}`;
      const cached = await getCache(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        res.json(parsed);
        return;
      }

      let rawResponse = await generateContentWithFallback(prompt);
      if (rawResponse) {
        rawResponse = rawResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
      }
      
      let title = '';
      let summary = '';
      try {
        const parsed = JSON.parse(rawResponse || '{}');
        title = parsed.title;
        summary = parsed.summary;
        
        // Save to cache for 24 hours
        await setCache(cacheKey, JSON.stringify({ title, summary }), 86400);
      } catch (parseError) {
        console.error('Failed to parse JSON from Gemini:', rawResponse);
        summary = rawResponse || 'Summary generation failed.';
      }

      res.json({ summary, title });
    } catch (error: any) {
      console.error("Summarize Error:", error);
      res.status(500).json({ error: "Failed to generate summary." });
    }
  });


  // API to summarize themes
  app.post("/api/overview", authenticateToken, async (req: express.Request, res: express.Response) => {
    try {
      const data = (req.body && typeof req.body === 'object') ? req.body : {};
      const { entries } = data;
      
      if (!entries || !Array.isArray(entries) || entries.length === 0) {
        res.status(400).json({ error: 'Entries are required' });
        return;
      }

      const textToAnalyze = entries.map((e: any) => `Title: ${e.title}\nSummary: ${e.summary || 'No summary'}\nTags: ${e.tags?.join(', ')}\nMood: ${e.mood || 'None'}`).join('\n\n');
      
      const prompt = `Analyze the following recent journal entries (which are tagged 'Personal' or 'Ideas'). Identify 3 to 4 recurring themes, insights, or patterns. Write a cohesive, thoughtful, and concise weekly summary (under 150 words) that reflects on the user's emotional and mental journey. Return ONLY the text of the summary, no JSON or markdown wrapping.

Entries:
${textToAnalyze}`;

      const cacheKey = `overview:${crypto.createHash('sha256').update(prompt).digest('hex')}`;
      const cached = await getCache(cacheKey);
      if (cached) {
        res.json({ overview: cached });
        return;
      }

      const overviewText = await generateContentWithFallback(prompt);
      await setCache(cacheKey, (overviewText || '').trim(), 86400);

      res.json({ overview: (overviewText || '').trim() });
    } catch (error: any) {
      console.error("Overview Error:", error);
      res.status(500).json({ error: "Failed to generate overview." });
    }
  });

  // Feature 1: Mood Wrapped
  app.post("/api/wrapped", authenticateToken, async (req: express.Request, res: express.Response) => {
    try {
      const entries = req.body.entries;
      if (!entries || entries.length === 0) {
        res.json({ wrapped: { data: [], growth_summary: "You haven't written any entries in the last 30 days. Start journaling to see your Mood Wrapped!" } });
        return;
      }

      const prompt = `Analyze these journal entries from the last 30 days. Return a JSON object with two keys:
1. "data": a JSON array of objects representing the timeline. Each object must contain:
   - "date": The ISO date string of the entry
   - "primary_mood": A 1-2 word description of the mood based on the entry (e.g. "Joyful", "Stressed", "Reflective")
   - "hex_color": A CSS hex color code that visually represents this mood (e.g. #FFD700 for happy, #4A90E2 for calm).
2. "growth_summary": A single paragraph (under 100 words) summarizing the emotional growth or patterns observed.

Entries:
${JSON.stringify(entries)}
`;

      const responseText = await generateContentWithFallback(prompt, true);
      let parsed = { data: [], growth_summary: "" };
      if (responseText) {
         try {
           parsed = JSON.parse(responseText.replace(/```json/gi, '').replace(/```/g, '').trim());
         } catch (e) {
           console.error("Failed to parse Mood Wrapped JSON");
         }
      }
      res.json({ wrapped: parsed });
    } catch (error: any) {
      console.error("Mood Wrapped Error:", error);
      res.status(500).json({ error: "Failed to generate Mood Wrapped." });
    }
  });

  // Feature 2: Context-Aware Daily Prompts
  app.post("/api/daily-prompt", authenticateToken, async (req: express.Request, res: express.Response) => {
    try {
      const { entries } = req.body || {};
      let prompt = "Act as an empathetic journaling coach. Generate a generic, warm, single 1-sentence question to kickstart today's journal entry.";
      
      if (entries && entries.length > 0) {
        prompt = `Act as an empathetic journaling coach. Read these last 3 entries of the user and generate a single, highly specific 1-2 sentence question to kickstart today's journal entry. Reference their ongoing struggles, joys, or goals. Keep it warm and inviting. DO NOT answer the prompt yourself. ONLY return the prompt.
Entries:
${JSON.stringify(entries)}`;
      }

      const generatedPrompt = await generateContentWithFallback(prompt);
      res.json({ prompt: (generatedPrompt || "How was your day today?").trim() });
    } catch (error: any) {
      console.error("Daily Prompt Error:", error);
      res.status(500).json({ error: "Failed to generate prompt." });
    }
  });

  // Feature 3: Smart Automated Personalized Emails via Cron
  app.post("/api/cron/smart-email", verifyCronOIDC, async (req: express.Request, res: express.Response) => {
    try {
      console.log("Triggered Smart Email Cron Job");

      // In a real application, you would query an opt-in list.
      // E.g. db.collection('users').where('emailOptIn', '==', true).get();
      // Since we don't have that field, we'll fetch all top-level user documents that might exist.
      // (This requires setting up a users collection properly. For this demo, we mock the retrieval loop)
      const usersSnapshot = await db.collection('users').where('emailOptIn', '==', true).get(); 

      // Fetch Mail Credentials from Secret Manager securely.
      const SMTP_HOST = await accessSecret('projects/sound-beaker-g8chg/secrets/SMTP_HOST/versions/latest');
      const SMTP_USER = await accessSecret('projects/sound-beaker-g8chg/secrets/SMTP_USER/versions/latest');
      const SMTP_PASS = await accessSecret('projects/sound-beaker-g8chg/secrets/SMTP_PASS/versions/latest');

      let transporter: any = null;
      if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
        transporter = nodemailer.createTransport({
          host: SMTP_HOST,
          port: 587,
          secure: false,
          auth: { user: SMTP_USER, pass: SMTP_PASS },
        });
      }

      const currentHour = new Date().getUTCHours();
      let emailsSent = 0;

      for (const userDoc of usersSnapshot.docs) {
        const uid = userDoc.id;
        const userData = userDoc.data();
        
        // Calculate Most Active Hour
        let activeHour = 21; // Default 9 PM
        const allJournalsSnap = await db.collection('users').doc(uid).collection('journals').get();
        if (!allJournalsSnap.empty) {
           let sumHours = 0;
           let count = 0;
           allJournalsSnap.forEach(doc => {
              const data = doc.data();
              if (data.createdAt) {
                 const d = new Date(data.createdAt);
                 sumHours += d.getUTCHours();
                 count++;
              }
           });
           if (count > 0) activeHour = Math.round(sumHours / count);
        }

        if (activeHour !== currentHour) {
           continue; // Skip if it's not their active hour
        }
        
        const fortyEightHoursAgo = new Date();
        fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

        const journalsSnap = await db.collection('users').doc(uid).collection('journals')
          .where('createdAt', '>=', fortyEightHoursAgo.getTime())
          .orderBy('createdAt', 'desc')
          .limit(5)
          .get();

        if (journalsSnap.empty) continue; // No recent entries to reflect on

        const entries = journalsSnap.docs.map(doc => doc.data().summary || doc.data().title).join('\n');
        
        const prompt = `Write a short, warm, personalized check-in email (2-3 sentences) acting as a journaling companion. Reference these entries from the last 48 hours. DO NOT include a subject line, just the body text.
Entries:
${entries}`;

        const emailBody = await generateContentWithFallback(prompt);

        if (transporter && userData.email) {
          await transporter.sendMail({
             from: '"Reflect AI Journal" <noreply@reflectai.app>',
             to: userData.email,
             subject: "Your Daily Reflection Check-In",
             text: emailBody || "It's time to journal!",
          });
          emailsSent++;
        }
      }

      res.json({ success: true, emailsSent });
    } catch (error: any) {
      console.error("Cron Email Error:", error);
      console.error(error); res.status(500).json({ error: "Failed to process smart emails.", details: String(error), stack: error.stack });
    }
  });


  app.post("/api/reflect-agent", authenticateToken, async (req: express.Request, res: express.Response) => {
    try {
      const data = (req.body && typeof req.body === 'object') ? req.body : {};
      const { action, payload } = data;
      
      if (!action || !payload) {
        return res.status(400).json({ error: "Missing action or payload" });
      }

      const promptText = `${reflectSystemPrompt}

USER INPUT:
{"action": "${action}", "data": ${JSON.stringify(payload)}}`;

      const responseText = await generateContentWithFallback(promptText, true);
      
      let parsed = {};
      if (responseText) {
         try {
           parsed = JSON.parse(responseText.replace(/```json/gi, '').replace(/```/g, '').trim());
         } catch (e) {
           console.error("Reflect Agent JSON parse error:", e, responseText);
           return res.status(500).json({ error: "Invalid JSON response from AI." });
         }
      }
      
      res.json(parsed);
    } catch (error: any) {
      console.error("Reflect Agent Error:", error);
      res.status(500).json({ error: "Failed to process agent request." });
    }
  });

  // Vite middleware for development

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Support Express 4/5 routing catch-all
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
