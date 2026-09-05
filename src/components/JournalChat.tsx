import React, { useState, useEffect, useRef } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteField, getDocs, limit } from 'firebase/firestore';
import { db, auth, storage } from '../firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../AuthContext';
import { JournalEntry, JournalMessage } from '../types';
import { Palette, Lightbulb, Copy, Loader2, MessageSquare, ArrowLeft, Send, Sparkles, AlertCircle, Home, PanelLeft, PanelLeftClose, Tag as TagIcon, X, ImagePlus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../utils/firestore';

export default function JournalChat({ journal, onBack, isSidebarOpen, onToggleSidebar, theme = 'theme-default', recentJournals = [] }: { key?: React.Key, journal: JournalEntry, onBack: () => void, isSidebarOpen?: boolean, onToggleSidebar?: () => void, theme?: string, recentJournals?: JournalEntry[] }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<JournalMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [streamingReply, setStreamingReply] = useState('');

  const [dailyPrompts, setDailyPrompts] = useState<string[]>([]);
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  
  const fetchAgentInsights = async (action: string, payload: any) => {
    if (!user) return null;
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/reflect-agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ action, payload })
      });
      if (!response.ok) throw new Error('Failed to fetch from agent');
      return await response.json();
    } catch (err) {
      console.error(err);
      return null;
    }
  };

  const handleGenerateDailyPrompts = async () => {
    setIsGeneratingPrompts(true);
    const recent = recentJournals.slice(0, 3).map(j => ({ date: j.createdAt, summary: j.summary || '', mood: j.mood || '' }));
    const data = await fetchAgentInsights('generate_daily_prompts', { entries: recent });
    if (data?.prompts) {
       setDailyPrompts(data.prompts);
    }
    setIsGeneratingPrompts(false);
  };

  const [error, setError] = useState('');
  const [selectedMood, setSelectedMood] = useState<string | null>(journal.mood || null);
  const [showTagInput, setShowTagInput] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [dynamicPlaceholder, setDynamicPlaceholder] = useState("Share your thoughts or ask Gemini for reflection...");
  
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [viewImage, setViewImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasFetchedPrompts = useRef(false);
  useEffect(() => {
    if (messages.length === 0 && dailyPrompts.length === 0 && !isGeneratingPrompts && !hasFetchedPrompts.current) {
       hasFetchedPrompts.current = true;
       handleGenerateDailyPrompts();
    }
  }, [messages.length, dailyPrompts.length]);


  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    
    // Check if chat already has an image (using the journal's accumulated images)
    if (journal.images && journal.images.length >= 1) {
      setError("This chat already has an image attached. Only one image is allowed per chat thread.");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const files = Array.from(e.target.files);
    
    if (selectedImages.length + files.length > 1) {
      setError("Maximum 1 image allowed per message.");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_SIZE = 800;
          if (width > height) {
            if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
          } else {
            if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
          setSelectedImages(prev => [...prev, dataUrl]);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file as File);
    });
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeSelectedImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const SUGGESTED_TAGS = ['Work', 'Personal', 'Ideas', 'Gratitude', 'Health', 'Travel'];

  const handleAddTag = async (tagToAdd: string) => {
    if (!tagToAdd.trim() || !user || !journal.id) return;
    const tag = tagToAdd.trim().toLowerCase();
    
    const currentTags = journal.tags || [];
    if (currentTags.includes(tag)) {
      setNewTag('');
      setShowTagInput(false);
      return;
    }
    
    if (currentTags.length >= 5) {
      setError('Maximum 5 tags allowed.');
      return;
    }

    try {
      const updatedTags = [...currentTags, tag];
      await updateDoc(doc(db, 'users', user.uid, 'journals', journal.id), {
        tags: updatedTags,
        updatedAt: serverTimestamp()
      });
      journal.tags = updatedTags; // Optimistic local update
      setNewTag('');
      setShowTagInput(false);
    } catch (err) {
      console.error(err);
      setError('Failed to add tag.');
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!user || !journal.id) return;
    try {
      const currentTags = journal.tags || [];
      const updatedTags = currentTags.filter(t => t !== tagToRemove);
      await updateDoc(doc(db, 'users', user.uid, 'journals', journal.id), {
        tags: updatedTags,
        updatedAt: serverTimestamp()
      });
      journal.tags = updatedTags; // Optimistic local update
    } catch (err) {
      console.error(err);
      setError('Failed to remove tag.');
    }
  };

  const MOODS = [
    { emoji: '😃', label: 'Happy' },
    { emoji: '😌', label: 'Calm' },
    { emoji: '😐', label: 'Neutral' },
    { emoji: '😔', label: 'Sad' },
    { emoji: '😡', label: 'Angry' },
    { emoji: '😰', label: 'Anxious' }
  ];

  useEffect(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [messages, streamingReply]);

  useEffect(() => {
    if (!user || !journal.id) return;
    const q = query(collection(db, 'users', user.uid, 'journals', journal.id, 'messages'), orderBy('timestamp', 'asc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: JournalMessage[] = [];
      snapshot.forEach((doc) => {
        msgs.push({ id: doc.id, ...doc.data() } as JournalMessage);
      });
      setMessages(msgs);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/journals/${journal.id}/messages`, auth);
    });

    auth.currentUser?.getIdToken().then(async token => {
      try {
        const { getDocs, query, collection, orderBy, limit } = await import('firebase/firestore');
        const q = query(collection(db, 'users', user.uid, 'journals'), orderBy('createdAt', 'desc'), limit(3));
        const snapshot = await getDocs(q);
        const entries = snapshot.docs.map(doc => ({
           title: doc.data().title,
           summary: doc.data().summary || '',
           mood: doc.data().mood || ''
        }));
        
        const res = await fetch('/api/daily-prompt', {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ entries })
        });
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        if (data.prompt) setDynamicPlaceholder(data.prompt);
      } catch (err) {
        console.error("Failed to load daily prompt", err);
      }
    });

    return () => unsubscribe();
  }, [user, journal.id]);

  const handleMoodSelect = async (mood: string | null) => {
    setSelectedMood(mood);
    if (user && journal.id) {
      try {
        const updateData: any = { updatedAt: serverTimestamp() };
        // We only allow setting or changing mood; if we want to remove it, we'd need to use deleteField().
        // For simplicity, we just set the mood if it's not null, or omit it if it is. 
        // Or wait, if mood is null, we can just leave it as is or we can import deleteField and use it.
        // Actually, just updating the local state is good, but let's persist it:
        if (mood) {
           updateData.mood = mood;
           await updateDoc(doc(db, 'users', user.uid, 'journals', journal.id), updateData);
           journal.mood = mood; // optimistic
        } else {
           updateData.mood = deleteField();
           await updateDoc(doc(db, 'users', user.uid, 'journals', journal.id), updateData);
           delete journal.mood; // optimistic
        }
      } catch (err) {
        console.error('Failed to update journal mood', err);
      }
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const currentImages = [...selectedImages];
    if ((!input.trim() && currentImages.length === 0) || !user || !journal.id || isTyping) return;

    const userMessageContent = input.trim();
    const messageMood = selectedMood;
    setInput('');
    setSelectedImages([]);
    setIsTyping(true);
    setError('');
    setStreamingReply('');

    try {
      // 1. Upload images via backend to Cloudinary
      let uploadedImageUrls: string[] = [];
      if (currentImages.length > 0) {
        try {
          const idToken = await user.getIdToken();
          const uploadRes = await fetch('/api/upload', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ images: currentImages })
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            if (uploadData.urls && Array.isArray(uploadData.urls)) {
              uploadedImageUrls = uploadData.urls;
            }
          } else {
            console.error('Failed to upload images, status:', uploadRes.status);
            uploadedImageUrls = currentImages; // Fallback to base64 if upload fails
          }
        } catch (uploadErr) {
          console.error("Failed to upload image to Cloudinary, falling back to base64", uploadErr);
          uploadedImageUrls = currentImages; // Fallback to base64
        }
      }

      // 2. Save user message to Firestore with the Storage URLs
      await addDoc(collection(db, 'users', user.uid, 'journals', journal.id, 'messages'), {
        role: 'user',
        content: userMessageContent,
        timestamp: serverTimestamp(),
        ...(messageMood ? { mood: messageMood } : {}),
        ...(uploadedImageUrls.length > 0 ? { images: uploadedImageUrls } : {})
      });
      
      // Update journal with the latest mood if selected and append images
      const journalUpdates: any = { updatedAt: serverTimestamp() };
      if (messageMood) {
        journalUpdates.mood = messageMood;
      }
      if (uploadedImageUrls.length > 0) {
        journalUpdates.images = [...(journal.images || []), ...uploadedImageUrls].slice(0, 1);
        journal.images = journalUpdates.images;
      }
      if (Object.keys(journalUpdates).length > 1) { // More than just updatedAt
        await updateDoc(doc(db, 'users', user.uid, 'journals', journal.id), journalUpdates);
      }


      // 2. Call backend for Gemini reply (Streaming)
      const idToken = await user.getIdToken();
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ 
          prompt: userMessageContent, 
          images: currentImages,
          history: messages.map(m => ({ role: m.role, content: m.content, images: m.images })) 
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to fetch AI response (' + res.status + ')');
      }
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullReply = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '').trim();
            if (dataStr === '[DONE]') break;
            if (!dataStr) continue;
            
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.text) {
                fullReply += parsed.text;
                setStreamingReply(fullReply);
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e, dataStr);
            }
          }
        }
      }

      // 3. Save AI reply to Firestore
      await addDoc(collection(db, 'users', user.uid, 'journals', journal.id, 'messages'), {
        role: 'model',
        content: fullReply,
        timestamp: serverTimestamp()
      });

      // Calculate word count
      const wordsInExchange = (userMessageContent.match(/\b\w+\b/g)?.length || 0) + (fullReply.match(/\b\w+\b/g)?.length || 0);
      const updatedWordCount = (journal.wordCount || 0) + wordsInExchange;
      
      await updateDoc(doc(db, 'users', user.uid, 'journals', journal.id), {
        wordCount: updatedWordCount,
        updatedAt: serverTimestamp()
      });
      journal.wordCount = updatedWordCount; // Optimistic update

      setStreamingReply('');

      // Auto-summarize on first exchange
      if (messages.length === 0) {
        setTimeout(() => {
          handleSummarize([{ role: 'user', content: userMessageContent }, { role: 'model', content: fullReply }]);
        }, 500);
      }

    } catch (err: any) {
      console.error(err);
      setError('An error occurred. Please try again.');
      setStreamingReply('');
    } finally {
      setIsTyping(false);
    }
  };

  const handleSummarize = async (messagesToSummarize = messages) => {
    if (!user || !journal.id || messagesToSummarize.length === 0 || isTyping) return;
    setIsTyping(true);
    setError('');

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ messages: messagesToSummarize.map(m => ({ role: m.role, content: m.content })) })
      });

      if (!res.ok) throw new Error('Failed to fetch summary');
      const data = await res.json();

      // Update journal summary and title in Firestore
      const updates: any = {
        summary: data.summary,
        updatedAt: serverTimestamp()
      };
      if (data.title) {
        updates.title = data.title;
      }
      await updateDoc(doc(db, 'users', user.uid, 'journals', journal.id), updates);

    } catch (err: any) {
      console.error(err);
      setError('Failed to generate summary.');
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className={`flex flex-col h-full w-full relative ${theme === 'theme-hc-light' ? 'bg-gray-50 text-black' : 'bg-transparent'} font-sans`}>
      <header className={`${theme === 'theme-hc-light' ? 'bg-white/90 border-gray-200' : 'bg-[#0a0a0a]/80 border-slate-800/50'} backdrop-blur-md border-b px-6 py-4 flex flex-col gap-3 z-10 shrink-0`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className={`p-2 rounded-full transition-colors ${theme === 'theme-hc-light' ? 'hover:bg-gray-100' : 'hover:bg-slate-800'}`}>
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-xl font-bold tracking-tight">
                {journal.date ? format(journal.date, 'EEEE, MMMM d') : 'New Entry'}
              </h2>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-bold border border-emerald-500/20 hidden sm:inline">ACTIVE SESSION</span>
            </div>
          </div>
        </div>

        {/* Tags Section */}
        <div className="flex items-center gap-2 flex-wrap ml-12">
          {journal.tags?.map(tag => (
            <span key={tag} className={`flex items-center gap-1 px-2 py-1 text-[10px] uppercase font-bold tracking-wider rounded border ${theme === 'theme-hc-light' ? 'bg-gray-100 text-gray-700 border-gray-300' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>
              #{tag}
              <button onClick={() => handleRemoveTag(tag)} className={`ml-1 ${theme === 'theme-hc-light' ? 'hover:text-red-500' : 'hover:text-red-400'}`}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          
          <div className="relative">
            {!showTagInput ? (
              <button 
                onClick={() => setShowTagInput(true)}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] uppercase font-bold tracking-wider rounded border transition-colors border-dashed ${theme === 'theme-hc-light' ? 'bg-white hover:bg-gray-50 text-gray-500 hover:text-emerald-600 border-gray-300' : 'bg-slate-900 hover:bg-slate-800 text-slate-500 hover:text-emerald-400 border-slate-800'}`}
              >
                <TagIcon className="w-3 h-3" /> ADD TAG
              </button>
            ) : (
              <div className={`flex items-center gap-2 rounded px-2 py-1 shadow-lg absolute top-0 left-0 z-20 min-w-[200px] border ${theme === 'theme-hc-light' ? 'bg-white border-emerald-500' : 'bg-slate-900 border-emerald-500/50'}`}>
                <TagIcon className="w-3 h-3 text-emerald-500" />
                <input
                  autoFocus
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddTag(newTag);
                    if (e.key === 'Escape') setShowTagInput(false);
                  }}
                  onBlur={() => setTimeout(() => setShowTagInput(false), 200)}
                  placeholder="Type or select..."
                  className={`bg-transparent border-none text-[10px] uppercase font-bold tracking-wider focus:outline-none w-24 ${theme === 'theme-hc-light' ? 'text-gray-900 placeholder-gray-400' : 'text-slate-200'}`}
                />
                
                {/* Suggestions Popover */}
                {newTag === '' && (
                  <div className={`absolute top-full left-0 mt-1 w-48 border rounded-lg shadow-xl overflow-hidden py-1 ${theme === 'theme-hc-light' ? 'bg-white border-gray-200' : 'bg-slate-800 border-slate-700'}`}>
                    <div className={`px-3 py-1 text-[9px] uppercase font-bold tracking-widest ${theme === 'theme-hc-light' ? 'text-gray-500 bg-gray-50' : 'text-slate-500 bg-slate-900/50'}`}>Suggested</div>
                    {SUGGESTED_TAGS.filter(t => !(journal.tags || []).includes(t.toLowerCase())).map(st => (
                      <button
                        key={st}
                        onClick={() => handleAddTag(st)}
                        className={`w-full text-left px-3 py-1.5 text-xs ${theme === 'theme-hc-light' ? 'text-gray-700 hover:bg-emerald-50 hover:text-emerald-600' : 'text-slate-300 hover:bg-emerald-500/20 hover:text-emerald-400'}`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="max-w-2xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="text-center py-10 md:py-20 flex flex-col items-center">
              <h3 className={`text-2xl font-semibold tracking-tight mb-2 ${theme === 'theme-hc-light' ? 'text-black' : 'text-slate-200'}`}>Start reflecting</h3>
              <p className={`max-w-md mx-auto text-sm leading-relaxed mb-8 ${theme === 'theme-hc-light' ? 'text-gray-600' : 'text-slate-500'}`}>Write down your thoughts, a problem you're trying to solve, or just how your day went. I'm here to listen and offer perspective.</p>
              
              <div className="max-w-md w-full px-4">
                {isGeneratingPrompts && (
                  <div className="flex flex-col items-center justify-center p-6 text-indigo-500 opacity-70">
                    <Loader2 className="w-6 h-6 animate-spin mb-2" />
                    <p className="text-sm">Thinking of some ideas...</p>
                  </div>
                )}
                
                {dailyPrompts.length > 0 && (
                  <div className="mt-6 space-y-3">
                    <p className={`text-xs font-bold uppercase tracking-widest text-left ${theme === 'theme-hc-light' ? 'text-gray-400' : 'text-slate-500'}`}>Prompt Ideas</p>
                    {dailyPrompts.map((p, i) => (
                      <button 
                        key={i}
                        onClick={() => { setInput(p); setDailyPrompts([]); }}
                        className={`w-full text-left p-4 rounded-xl text-sm transition-all border ${theme === 'theme-hc-light' ? 'bg-white border-gray-200 hover:border-indigo-300 hover:shadow-md text-gray-700' : 'bg-slate-800/50 border-slate-700/50 hover:border-indigo-500/50 hover:bg-slate-800 text-slate-300'}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          
          {messages.map((msg, i) => (
            <motion.div 
              key={msg.id || i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              {msg.role === 'model' && (
                <div className="flex gap-4 w-full">
                  <div className="w-8 h-8 rounded-lg bg-emerald-600/20 flex items-center justify-center border border-emerald-500/30 flex-shrink-0 mt-2">
                    <div className="w-4 h-4 bg-emerald-500 rounded-sm rotate-45"></div>
                  </div>
                  <div className="space-y-1 w-full max-w-[90%]">
                    <div className={`p-5 rounded-2xl rounded-tl-none text-sm leading-relaxed border ${theme === 'theme-hc-light' ? 'bg-white border-emerald-200 text-gray-800 shadow-sm' : 'bg-emerald-900/10 border-emerald-500/10 text-slate-300'}`}>
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                    <span className={`text-[10px] uppercase tracking-tighter font-medium ml-1 ${theme === 'theme-hc-light' ? 'text-gray-500' : 'text-slate-500'}`}>Gemini • Reflection Agent</span>
                  </div>
                </div>
              )}
              
              {msg.role === 'user' && (
                <div className="flex flex-col items-end max-w-[85%]">
                  <div className={`p-4 rounded-2xl rounded-tr-none text-sm leading-relaxed shadow-sm relative ${theme === 'theme-hc-light' ? 'bg-gray-100 text-gray-900 border border-gray-200' : 'bg-slate-800 text-slate-100'}`}>
                    {msg.mood && (
                      <div className={`absolute -top-3 -left-3 text-xl border rounded-full w-8 h-8 flex items-center justify-center shadow-sm ${theme === 'theme-hc-light' ? 'bg-white border-gray-200' : 'bg-slate-900 border-slate-700'}`}>
                        {msg.mood}
                      </div>
                    )}
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2 justify-end w-full">
                        {msg.images.map((img, idx) => (
                          <img 
                            key={idx} 
                            src={img} 
                            alt="attached" 
                            onClick={() => setViewImage(img)}
                            className="w-full h-auto max-h-[400px] rounded-xl object-contain border border-slate-600/50 cursor-pointer hover:opacity-90 transition-opacity" 
                          />
                        ))}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                  <span className={`text-[10px] uppercase tracking-tighter font-medium mt-2 mr-1 ${theme === 'theme-hc-light' ? 'text-gray-500' : 'text-slate-500'}`}>You</span>
                </div>
              )}
            </motion.div>
          ))}
          
          {streamingReply ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
               <div className="flex gap-4 w-full">
                 <div className="w-8 h-8 rounded-lg bg-emerald-600/20 flex items-center justify-center border border-emerald-500/30 flex-shrink-0 mt-2">
                    <div className="w-4 h-4 bg-emerald-500 rounded-sm rotate-45"></div>
                 </div>
                 <div className="space-y-1 w-full max-w-[90%]">
                   <div className={`p-5 rounded-2xl rounded-tl-none text-sm leading-relaxed border ${theme === "theme-hc-light" ? "bg-white border-emerald-200 text-gray-800 shadow-sm" : "bg-emerald-900/10 border-emerald-500/10 text-slate-300"}`}>
                     <div className="whitespace-pre-wrap">{streamingReply}<span className="inline-block w-1.5 h-4 ml-1 bg-emerald-500/80 animate-pulse align-middle"></span></div>
                   </div>
                   <span className={`text-[10px] ml-1 uppercase tracking-tighter font-medium ${theme === "theme-hc-light" ? "text-gray-500" : "text-slate-500"}`}>Gemini • Reflection Agent</span>
                 </div>
               </div>
            </motion.div>
          ) : isTyping && (
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
               <div className="flex gap-4">
                 <div className="w-8 h-8 rounded-lg bg-emerald-600/20 flex items-center justify-center border border-emerald-500/30 flex-shrink-0">
                    <div className="w-4 h-4 bg-emerald-500 rounded-sm rotate-45"></div>
                 </div>
                 <div className="bg-emerald-900/10 border border-emerald-500/10 rounded-2xl rounded-tl-none px-5 py-4 flex items-center gap-2">
                   <div className="w-1.5 h-1.5 bg-emerald-500/50 rounded-full animate-bounce"></div>
                   <div className="w-1.5 h-1.5 bg-emerald-500/50 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                   <div className="w-1.5 h-1.5 bg-emerald-500/50 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                 </div>
               </div>
             </motion.div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-400 bg-red-900/10 p-3 rounded-lg border border-red-900/50 text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </main>

      <footer className={`p-4 sm:p-8 shrink-0 relative border-t ${theme === 'theme-hc-light' ? 'bg-white border-gray-200' : 'bg-[#0a0a0a] border-slate-800/50'}`}>
        <div className={`absolute top-[-40px] left-0 right-0 h-[40px] bg-gradient-to-t ${theme === 'theme-hc-light' ? 'from-white' : 'from-[#0a0a0a]'} to-transparent pointer-events-none`}></div>
        <form onSubmit={handleSend} className="max-w-2xl mx-auto relative">
          <div className="flex gap-2 mb-3">
            {MOODS.map(m => (
              <button
                key={m.emoji}
                type="button"
                onClick={() => handleMoodSelect(selectedMood === m.emoji ? null : m.emoji)}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  selectedMood === m.emoji 
                    ? (theme === 'theme-hc-light' ? 'bg-gray-100 scale-110 border border-emerald-500 shadow-md grayscale-0' : 'bg-slate-700 scale-110 border border-emerald-500/50 shadow-md grayscale-0') 
                    : (theme === 'theme-hc-light' ? 'hover:bg-gray-100 grayscale hover:grayscale-0 opacity-60 hover:opacity-100' : 'hover:bg-slate-800 grayscale hover:grayscale-0 opacity-60 hover:opacity-100')
                }`}
                title={m.label}
              >
                {m.emoji}
              </button>
            ))}
          </div>
          {selectedImages.length > 0 && (
            <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
              {selectedImages.map((img, i) => (
                <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden shrink-0 border border-slate-700 group">
                  <img src={img} alt="upload preview" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeSelectedImage(i)}
                    className="absolute top-1 right-1 bg-black/60 p-1 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="relative">
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageSelect} 
              accept="image/*" 
              multiple 
              className="hidden" 
            />
            <textarea 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={dynamicPlaceholder}
              className={`w-full border rounded-2xl p-4 pr-28 text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 resize-none transition-colors ${
                theme === 'theme-hc-light' ? 'bg-white border-gray-300 text-black placeholder-gray-500 shadow-sm' : 'bg-slate-900/50 border-slate-700 text-slate-100 placeholder-slate-600'
              }`}
              rows={3}
              disabled={isTyping}
            />
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isTyping}
                className={`p-2 rounded-xl transition-all ${theme === 'theme-hc-light' ? 'text-gray-500 hover:bg-gray-100' : 'text-slate-400 hover:bg-slate-800'}`}
              >
                <ImagePlus className="w-5 h-5" />
              </button>
              <button 
                type="submit"
                disabled={(!input.trim() && selectedImages.length === 0) || isTyping}
                className="p-2 bg-emerald-600 rounded-xl hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
              >
                <Send className="w-5 h-5 text-white ml-0.5 mt-0.5" />
              </button>
            </div>
          </div>
          <div className="flex justify-end items-center mt-4">
            
            <div className="text-[10px] text-slate-500 font-medium">
              {messages.filter(m => m.role === 'user').reduce((acc, msg) => acc + msg.content.trim().split(/\s+/).filter(Boolean).length, 0)} words written
            </div>
          </div>
        </form>
      </footer>

      <AnimatePresence>
        {viewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm"
            onClick={() => setViewImage(null)}
          >
            <button 
              className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
              onClick={() => setViewImage(null)}
            >
              <X className="w-6 h-6" />
            </button>
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              src={viewImage}
              alt="fullscreen"
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
