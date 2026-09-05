# Reflect AI Journal

**Live Deployment URL:** [https://reflect-ai-journal.ai.studio](https://reflect-ai-journal.ai.studio)

## 📖 Overview
Reflect AI Journal is a secure, intelligent, and interactive journaling application. It elevates traditional journaling by integrating an AI Reflection Agent (powered by Google's Gemini models) to help users process their thoughts, track moods, and summarize their entries over time. 

## ✨ Features
- **AI Reflection Agent**: Real-time conversational interface with Gemini AI within individual journal entries.
- **Secure User Authentication**: Seamless and secure login using Firebase Authentication.
- **Rich Media & Visuals**: Add image attachments to entries, viewable via a responsive full-screen lightbox.
- **Mood & Analytics Tracking**: Calendar views and dynamic charts to track mood trends and writing habits.
- **Robust Security**: Strict owner-bound isolation in Firestore ensures users can only read and write their own data.

## 🏗️ Architecture
- **Frontend**: React 18, Vite, Tailwind CSS, Recharts (for analytics), Framer Motion (for animations).
- **Backend API**: Node.js/Express full-stack proxy bundled via esbuild for Cloud Run.
- **Database**: Cloud Firestore (NoSQL) with secure Role-Based Access Control / Owner-Bound Rules.
- **AI Integration**: `@google/genai` Node SDK invoking `gemini-3.6-flash`.
- **Secrets Management**: Google Cloud Secret Manager.

---

## 🚀 Deployment & Configuration Guide (Google Cloud Run)

This section provides step-by-step instructions for developers and hackathon judges to securely configure, deploy, and verify the application on Google Cloud.

### 1. Environment & Prerequisites
1. Install the [Google Cloud SDK (\`gcloud\`)](https://cloud.google.com/sdk/docs/install).
2. Authenticate and set your project:
   ```bash
   gcloud auth login
   gcloud config set project <YOUR_PROJECT_ID>
   ```
3. Enable the necessary APIs:
   ```bash
   gcloud services enable run.googleapis.com secretmanager.googleapis.com firestore.googleapis.com
   ```

### 2. Secret Management Setup
To safely manage the Gemini API key without hardcoding it, we use Google Cloud Secret Manager.

```bash
# Create the secret
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"

# Populate the secret with your key
echo -n "YOUR_API_KEY_HERE" | gcloud secrets versions add GEMINI_API_KEY --data-file=-

# Grant the default Cloud Run service account access to read the secret
# (Replace YOUR_PROJECT_NUMBER with your actual Google Cloud Project Number)
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --member="serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 3. Database Security Configuration (Firestore)
This app uses strict, owner-bound path checking to guarantee data isolation. 

Deploy the following \`firestore.rules\` via the Firebase Console or Firebase CLI:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false; // Default deny
    }
    
    // Validate string ID shapes
    function isValidId(id) { return id is string && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\\\-]+$'); }
    
    match /users/{userId}/journals/{journalId} {
      // Users can only interact with their own journals based on the Auth UID
      allow read, delete: if request.auth != null && request.auth.uid == userId && isValidId(userId);
      allow create, update: if request.auth != null && request.auth.uid == userId && isValidId(userId);
      
      match /messages/{messageId} {
        // Users can only interact with messages within their own journals
        allow read, create, delete: if request.auth != null && request.auth.uid == userId && isValidId(userId);
      }
    }
  }
}
```

### 4. Cloud Run Deployment Flow
With secrets and database rules configured, deploy the bundled service to Cloud Run:

```bash
# Build the full-stack bundle locally
npm run build

# Deploy the application container
gcloud run deploy reflect-ai-journal \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest"
```

### 5. Required Campaign Labeling (Verification)
Apply the mandatory resource label to register the service for automated challenge verification:

```bash
gcloud run services update reflect-ai-journal \
  --update-labels=dev-tutorial=cloud-run-ai-challenge \
  --region=us-central1
```
