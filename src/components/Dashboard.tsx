import React, { useState, useEffect, useRef } from 'react';
import { collection, query, orderBy, onSnapshot, setDoc, serverTimestamp, doc, deleteDoc, updateDoc, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useAuth } from '../AuthContext';
import { JournalEntry } from '../types';
import { Plus, Book, Trash2, LogOut, PanelLeft, PanelLeftClose, MoreVertical, Edit2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JournalChat from './JournalChat';
import { handleFirestoreError, OperationType } from '../utils/firestore';
import { format } from 'date-fns';

import CalendarView from './CalendarView';
import InsightsView from './InsightsView';
import { LayoutGrid, Brain, Calendar as CalendarIcon, Sparkles, CheckSquare, Tag, CheckCircle2, Moon, Sun, X } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

export default function Dashboard() {
  const { user, logOut } = useAuth();
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [selectedJournal, setSelectedJournal] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [editingJournalId, setEditingJournalId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'feed' | 'calendar' | 'wrapped' | 'insights'>('feed');
  const [viewImage, setViewImage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilterTag, setSelectedFilterTag] = useState<string | null>(null);
  const [theme, setTheme] = useState<'theme-default' | 'theme-hc-dark' | 'theme-hc-light'>('theme-default');
  const [wrappedData, setWrappedData] = useState<any>(null);
  const [loadingWrapped, setLoadingWrapped] = useState(false);
  const [overview, setOverview] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [batchTag, setBatchTag] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users', user.uid, 'journals'), orderBy('createdAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries: JournalEntry[] = [];
      snapshot.forEach((doc) => {
        entries.push({ id: doc.id, ...doc.data() } as JournalEntry);
      });
      setJournals(entries);
      
      // Update selected journal safely using functional state update
      setSelectedJournal(prev => {
        if (prev) {
          const updated = entries.find(e => e.id === prev.id);
          return updated || prev;
        }
        return prev;
      });
      
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/journals`, auth);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]); // Removed selectedJournal?.id to prevent loop


  useEffect(() => {
    if (!user) return;
    let mounted = true;
    
    const syncMissedSummaries = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token || !user) return;
        
        const q = query(collection(db, 'users', user.uid, 'journals'));
        const snapshot = await getDocs(q);
        
        let syncCount = 0;
        for (const docSnap of snapshot.docs) {
           if (syncCount >= 1) break; // Only sync 1 missed summary per page load to avoid rate limits
           const journal = docSnap.data();
           if (!journal.summary || journal.summary.trim() === '') {
              // check if it has messages
              const msgQ = query(collection(db, 'users', user.uid, 'journals', docSnap.id, 'messages'), orderBy('timestamp', 'asc'));
              const msgSnap = await getDocs(msgQ);
              if (!msgSnap.empty) {
                 // Wait a few seconds to avoid conflicting with other initial API calls
                 await new Promise(r => setTimeout(r, 3000));
                 
                 const messagesToSummarize = msgSnap.docs.map(m => m.data());
                 const res = await fetch('/api/summarize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ messages: messagesToSummarize })
                 });
                 if (res.ok) {
                    const data = await res.json();
                    if (data.summary || data.title) {
                       await updateDoc(doc(db, 'users', user.uid, 'journals', docSnap.id), {
                          ...(data.summary ? { summary: data.summary } : {}),
                          ...(data.title ? { title: data.title } : {}),
                          updatedAt: serverTimestamp()
                       });
                       console.log("Synced missed summary for journal", docSnap.id);
                       syncCount++;
                    }
                 }
              }
           }
        }
      } catch (err) {
        console.error('Failed to sync missed summaries:', err);
      }
    };
    
    syncMissedSummaries();
    return () => { mounted = false; };
  }, [user]);

  const createNewJournal = async () => {
    if (!user) return;
    try {
      const newId = doc(collection(db, 'users', user.uid, 'journals')).id;
      const localDate = Date.now();
      const optimisticJournal = {
        id: newId,
        title: `Reflection ${format(new Date(), 'MMM d, yyyy')}`,
        createdAt: localDate as any,
        updatedAt: localDate as any,
        userId: user.uid,
        summary: ''
      };
      
      // Navigate immediately
      setSelectedJournal(optimisticJournal);
      
      // Save asynchronously without blocking UI
      await setDoc(doc(db, 'users', user.uid, 'journals', newId), {
        title: optimisticJournal.title,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        userId: user.uid,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/journals`, auth);
    }
  };

  const deleteJournal = async (journalId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpenId(null);
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'journals', journalId));
      if (selectedJournal?.id === journalId) {
        setSelectedJournal(null);
      }
    } catch (error) {
       handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/journals/${journalId}`, auth);
    }
  };

  const updateJournalTitle = async (id: string, newTitle: string) => {
    if (!user || !newTitle.trim()) {
      setEditingJournalId(null);
      return;
    }
    try {
      await updateDoc(doc(db, 'users', user.uid, 'journals', id), { title: newTitle.trim() });
      if (selectedJournal?.id === id) {
        setSelectedJournal(prev => prev ? { ...prev, title: newTitle.trim() } : prev);
      }
    } catch (error) {
      console.error('Error updating title:', error);
    }
    setEditingJournalId(null);
  };

  const handleEditTitle = (journal: JournalEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingJournalId(journal.id!);
    setEditingTitle(journal.title);
    setMenuOpenId(null);
  };

  const submitTitleEdit = (e: React.FormEvent | React.KeyboardEvent, id: string) => {
    e.preventDefault();
    updateJournalTitle(id, editingTitle);
  };

  const generateOverview = async () => {
    if (!user) return;
    setLoadingOverview(true);
    try {
      const personalIdeas = journals.filter(j => j.tags?.includes('Personal') || j.tags?.includes('Ideas')).slice(0, 10);
      if (personalIdeas.length === 0) {
        setOverview("Not enough entries tagged 'Personal' or 'Ideas' to generate an overview.");
        return;
      }
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/overview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ entries: personalIdeas })
      });
      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
      const data = await res.json();
      setOverview(data.overview);
    } catch (err) {
      console.error(err);
      setOverview("Failed to load overview.");
    } finally {
      setLoadingOverview(false);
    }
  };

  const toggleBatchSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedBatchIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedBatchIds(next);
  };

  const applyBatchTag = async () => {
    if (!user || !batchTag.trim() || selectedBatchIds.size === 0) return;
    const tag = batchTag.trim();
    for (const id of Array.from(selectedBatchIds) as string[]) {
      const journal = journals.find(j => j.id === id);
      if (journal) {
        const currentTags = journal.tags || [];
        if (!currentTags.includes(tag)) {
          await updateDoc(doc(db, 'users', user.uid, 'journals', id), {
            tags: [...currentTags, tag]
          });
        }
      }
    }
    setBatchTag('');
    setSelectedBatchIds(new Set());
    setIsBatchMode(false);
  };

  const generateMoodWrapped = async () => {
    if (!user) return;
    setLoadingWrapped(true);
    setViewMode('wrapped');
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentEntries = journals
         .filter(j => j.createdAt && (j.createdAt as any).toDate() >= thirtyDaysAgo)
         .map(j => ({
            date: (j.createdAt as any).toDate().toISOString(),
            title: j.title,
            mood: j.mood || 'Unknown',
            summary: j.summary || ''
         }));

      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/wrapped', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ entries: recentEntries })
      });
      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
      const data = await res.json();
      setWrappedData(data.wrapped);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingWrapped(false);
    }
  };

  const filteredJournals = journals.filter(j => {
    const matchesSearch = searchQuery === '' || 
      j.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      j.summary?.toLowerCase().includes(searchQuery.toLowerCase()) || 
      j.tags?.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
      
    const matchesTag = !selectedFilterTag || j.tags?.includes(selectedFilterTag);
    return matchesSearch && matchesTag;
  });

  const allTags = Array.from(new Set(journals.flatMap(j => j.tags || []))).sort();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayWords = journals
    .filter(j => {
      const date = new Date((j.createdAt as any)?.toDate?.() || j.createdAt);
      return date >= todayStart;
    })
    .reduce((acc, j) => acc + (j.wordCount || 0), 0);
  const wordGoal = 500;
  const wordProgress = Math.min((todayWords / wordGoal) * 100, 100);

  // Mood frequency chart (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0);
  const moodChartDataMap = new Map<string, number>();
  journals.forEach(j => {
    const date = new Date((j.createdAt as any)?.toDate?.() || j.createdAt);
    if (date >= thirtyDaysAgo && j.mood) {
      const dateStr = format(date, 'MMM d');
      moodChartDataMap.set(dateStr, (moodChartDataMap.get(dateStr) || 0) + 1);
    }
  });
  const moodChartData = Array.from(moodChartDataMap.entries())
    .map(([date, count]) => ({ date, count }))
    .reverse();

  return (
    <div className={`flex w-full h-screen ${theme === 'theme-hc-light' ? 'bg-white text-black' : 'bg-[#0a0a0a] text-slate-100'} overflow-hidden font-sans transition-colors duration-300`}>
      <aside className={`w-full md:w-[320px] shrink-0 ${theme === 'theme-hc-light' ? 'bg-gray-50 border-gray-200' : 'bg-[#111111] border-slate-800'} border-r flex-col ${!isSidebarOpen ? 'hidden' : (selectedJournal ? 'hidden md:flex' : 'flex')}`}>
        <div className={`p-6 border-b ${theme === 'theme-hc-light' ? 'border-gray-200' : 'border-slate-800'} flex justify-between items-center`}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-5 h-5 bg-emerald-500 rounded-sm rotate-45"></div>
              <h1 className="text-xl font-semibold tracking-tight">Reflect.ai</h1>
            </div>
            <p className="text-xs text-slate-500 uppercase tracking-widest">Private Journal</p>
          </div>
          <button 
            onClick={createNewJournal}
            className="p-2 bg-emerald-600/10 text-emerald-500 rounded-lg hover:bg-emerald-600/20 transition-colors"
            title="New Entry"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        
        
        <div className="px-4 pt-4 pb-2">
          <div className="relative">
            <input 
              type="text" 
              placeholder="Search reflections..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full ${theme === 'theme-hc-light' ? 'bg-white border-gray-300 text-black placeholder-gray-500' : 'bg-slate-900 border-slate-700 text-slate-200 placeholder-slate-500'} border rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className={`text-xs font-bold ${theme === 'theme-hc-light' ? 'text-gray-500' : 'text-slate-600'} px-2 py-1 uppercase mb-2`}>Recent History</div>
          
          {loading ? (
            <div className="flex justify-center p-8">
              <div className="w-5 h-5 border-2 border-slate-700 border-t-emerald-500 rounded-full animate-spin"></div>
            </div>
          ) : filteredJournals.length === 0 ? (
            <div className="text-center p-6 mt-4">
              <p className={`${theme === 'theme-hc-light' ? 'text-gray-500' : 'text-slate-500'} text-sm`}>No reflections found.</p>
            </div>
          ) : (
            filteredJournals.map((journal, index) => (
              <motion.div 
                key={journal.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => setSelectedJournal(journal)}
                className={`p-3 rounded-lg cursor-pointer transition-all border group relative ${
                  selectedJournal?.id === journal.id 
                    ? (theme === 'theme-hc-light' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-800/60 border-slate-700')
                    : (theme === 'theme-hc-light' ? 'bg-transparent border-transparent hover:bg-gray-100' : 'bg-transparent border-transparent hover:bg-slate-800/30 hover:border-slate-800/50')
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  {editingJournalId === journal.id ? (
                    <form 
                      onSubmit={(e) => submitTitleEdit(e, journal.id!)}
                      className="flex-1 mr-2"
                      onClick={e => e.stopPropagation()}
                    >
                      <input
                        autoFocus
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={(e) => submitTitleEdit(e, journal.id!)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setEditingJournalId(null);
                          }
                        }}
                        className={`w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 ${theme === "theme-hc-light" ? "bg-white border-emerald-500/50 text-black" : "bg-slate-900 border-emerald-500/50 text-slate-200"}`}
                      />
                    </form>
                  ) : (
                    <div className={`text-sm font-medium truncate pr-2 ${theme === "theme-hc-light" ? "text-gray-900" : "text-slate-200"}`}>{journal.title}</div>
                  )}
                  
                  <div className="relative">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === journal.id ? null : journal.id!);
                      }}
                      className={`opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded ${theme === "theme-hc-light" ? "text-gray-400 hover:text-gray-700 hover:bg-gray-200" : "text-slate-600 hover:text-slate-300 hover:bg-slate-700"}`}
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                    
                    <AnimatePresence>
                      {menuOpenId === journal.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.1 }}
                          ref={menuRef}
                          className={`absolute right-0 top-6 w-32 rounded-lg shadow-xl overflow-hidden z-50 border ${theme === "theme-hc-light" ? "bg-white border-gray-200 shadow-sm" : "bg-slate-800 border-slate-700"}`}
                        >
                          <button
                            onClick={(e) => handleEditTitle(journal, e)}
                            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${theme === "theme-hc-light" ? "text-gray-700 hover:bg-gray-100 hover:text-gray-900" : "text-slate-300 hover:bg-slate-700 hover:text-white"}`}
                          >
                            <Edit2 className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button
                            onClick={(e) => deleteJournal(journal.id!, e)}
                            className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-widest font-medium">
                  {journal.createdAt ? format(new Date((journal.createdAt as any)?.toDate?.() || journal.createdAt), 'MMM d, yyyy') : 'Just now'}
                </div>
              </motion.div>
            ))
          )}
        </div>
        
        <div className={`p-4 border-t ${theme === 'theme-hc-light' ? 'border-gray-200' : 'border-slate-800'} flex flex-col gap-3`}>
          <div className="flex justify-between items-center">
            <span className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'theme-hc-light' ? 'text-gray-500' : 'text-slate-500'}`}>Theme</span>
            <button 
              onClick={() => setTheme(theme === 'theme-hc-light' ? 'theme-default' : 'theme-hc-light')}
              className={`p-2 rounded-full transition-colors ${theme === 'theme-hc-light' ? 'bg-gray-200 text-gray-800 hover:bg-gray-300' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
              title="Toggle Dark/Light Mode"
            >
              {theme === 'theme-hc-light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </div>
          <div className={`flex items-center gap-3 px-3 py-3 rounded-xl border ${theme === 'theme-hc-light' ? 'bg-white border-gray-200 shadow-sm' : 'bg-slate-900 border-slate-800'}`}>
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-400 shrink-0"></div>
            <div className="flex-1 overflow-hidden">
              <p className={`text-xs font-medium truncate ${theme === "theme-hc-light" ? "text-gray-900" : "text-slate-200"}`}>{user?.email}</p>
              
            </div>
            <button onClick={logOut} className={`p-1.5 rounded-lg transition-colors ${theme === "theme-hc-light" ? "text-gray-500 hover:text-gray-900 hover:bg-gray-100" : "text-slate-500 hover:text-slate-300 hover:bg-slate-800"}`} title="Log out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
      
      <main className={`flex-1 flex flex-col min-w-0 relative ${!selectedJournal ? 'hidden md:flex' : 'flex'}`}>
        {selectedJournal ? (
          <JournalChat 
            key={selectedJournal.id}
            journal={selectedJournal} 
            recentJournals={journals}
            onBack={() => setSelectedJournal(null)}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            theme={theme}
          />
        ) : (
          <div className={`flex-1 flex flex-col h-full ${theme === 'theme-hc-light' ? 'bg-gray-50' : (theme === 'theme-hc-dark' ? 'bg-black' : 'bg-[#0a0a0a]')} overflow-hidden`}>
            <header className={`${theme === 'theme-hc-light' ? 'bg-white/90 border-gray-200' : 'bg-[#0a0a0a]/80 border-slate-800/50'} backdrop-blur-md border-b px-6 py-4 flex items-center justify-between z-10 shrink-0`}>
              <div className="flex items-center gap-4">
                <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className={`hidden md:flex p-2 -ml-2 ${theme === 'theme-hc-light' ? 'text-gray-500 hover:text-black hover:bg-gray-100' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'} transition-colors rounded-lg`} title="Toggle Sidebar">
                  {isSidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeft className="w-5 h-5" />}
                </button>
                <h2 className={`text-sm font-medium ${theme === 'theme-hc-light' ? 'text-gray-900' : 'text-slate-300'}`}>Your Personal journal</h2>
              </div>
              <div className="flex items-center gap-4">
                <div className={`flex rounded-lg p-1 border ${theme === 'theme-hc-light' ? 'bg-gray-100 border-gray-200' : 'bg-[#111111] border-slate-800'}`}>
                  <button
                    onClick={() => setViewMode('feed')}
                    className={`p-1.5 rounded-md transition-colors ${viewMode === 'feed' ? (theme === 'theme-hc-light' ? 'bg-white text-black shadow-sm' : 'bg-slate-800 text-slate-200 shadow-sm') : (theme === 'theme-hc-light' ? 'text-gray-500 hover:text-gray-900' : 'text-slate-500 hover:text-slate-300')}`}
                    title="Timeline Feed"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('calendar')}
                    className={`p-1.5 rounded-md transition-colors ${viewMode === 'calendar' ? (theme === 'theme-hc-light' ? 'bg-white text-black shadow-sm' : 'bg-slate-800 text-slate-200 shadow-sm') : (theme === 'theme-hc-light' ? 'text-gray-500 hover:text-gray-900' : 'text-slate-500 hover:text-slate-300')}`}
                    title="Calendar View"
                  >
                    <CalendarIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={generateMoodWrapped}
                    className={`p-1.5 rounded-md transition-colors ${viewMode === 'wrapped' ? 'bg-emerald-500/20 text-emerald-500 shadow-sm' : (theme === 'theme-hc-light' ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50' : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20')}`}
                    title="Mood Wrapped"
                  >
                    <Sparkles className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('insights')}
                    className={`p-1.5 rounded-md transition-colors ${viewMode === 'insights' ? 'bg-indigo-500/20 text-indigo-500 shadow-sm' : (theme === 'theme-hc-light' ? 'text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50' : 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-900/20')}`}
                    title="AI Insights"
                  >
                    <Brain className="w-4 h-4" />
                  </button>
                </div>
                <button 
                  onClick={createNewJournal}
                  className={`text-white rounded-xl px-4 py-2 text-sm flex items-center gap-2 transition-colors shadow-lg ${theme === 'theme-hc-light' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20' : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20'}`}
                >
                  <Plus className="w-4 h-4" />
                  <span className="font-medium hidden sm:inline">New Entry</span>
                </button>
              </div>
            </header>
            
            {viewMode === 'insights' ? (
              <InsightsView journals={journals} theme={theme} />
            ) : viewMode === 'calendar' ? (
              <CalendarView journals={journals} onSelectJournal={setSelectedJournal} theme={theme} />
            ) : viewMode === 'wrapped' ? (
              <div className={`flex-1 overflow-y-auto p-6 md:p-8 ${theme === 'theme-hc-light' ? 'bg-gray-50' : 'bg-gradient-to-b from-[#0f1115] to-[#0a0a0a]'}`}>
                <div className="max-w-4xl mx-auto h-full flex flex-col justify-center items-center">
                  {loadingWrapped ? (
                    <div className="flex flex-col items-center gap-4">
                      <Sparkles className="w-8 h-8 text-emerald-500 animate-pulse" />
                      <p className={`text-sm ${theme === 'theme-hc-light' ? 'text-gray-500' : 'text-slate-400'}`}>Generating your emotional journey...</p>
                    </div>
                  ) : wrappedData ? (
                    <div className="w-full max-w-3xl flex flex-col gap-8">
                       <h2 className={`text-4xl font-semibold tracking-tight text-center ${theme === 'theme-hc-light' ? 'text-black' : 'text-slate-100'}`}>Your Mood Wrapped</h2>
                       
                       {/* Color Timeline */}
                       <div className="flex w-full h-16 rounded-full overflow-hidden shadow-lg border border-slate-700/50">
                         {wrappedData.data.map((item: any, i: number) => (
                           <div key={i} className="flex-1 transition-all hover:flex-[2] relative group" style={{ backgroundColor: item.hex_color }}>
                             <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-sm">
                               <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#0b0b0b', borderColor: '#060606' }}>{item.primary_mood}</span>
                             </div>
                           </div>
                         ))}
                       </div>

                       <div className={`p-8 rounded-3xl ${theme === 'theme-hc-light' ? 'bg-white shadow-xl border-gray-200' : 'bg-slate-900 border border-slate-800'}`}>
                         <h3 className={`text-sm font-bold uppercase tracking-widest mb-4 ${theme === 'theme-hc-light' ? 'text-gray-400' : 'text-slate-500'}`}>Growth Summary</h3>
                         <p className={`text-lg leading-relaxed ${theme === 'theme-hc-light' ? 'text-gray-800' : 'text-slate-300'}`}>
                           {wrappedData.growth_summary}
                         </p>
                       </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className={`text-sm ${theme === 'theme-hc-light' ? 'text-gray-500' : 'text-slate-400'}`}>No enough data to generate Mood Wrapped yet.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className={`flex-1 overflow-y-auto p-6 md:p-8 ${theme === 'theme-hc-light' ? 'bg-gray-50' : 'bg-gradient-to-b from-[#0f1115] to-[#0a0a0a]'}`}>
                <div className="max-w-4xl mx-auto">
                  <div className="mb-8">
                    <h2 className={`text-3xl font-semibold tracking-tight mb-2 ${theme === 'theme-hc-light' ? 'text-black' : 'text-slate-100'}`}>Your Journal Feed</h2>
                    
                    {/* Dashboard Widgets */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      {/* Word Count Goal */}
                      <div className={`p-5 rounded-2xl border flex items-center gap-4 ${theme === 'theme-hc-light' ? 'bg-white border-gray-200' : 'bg-slate-900 border-slate-800'}`}>
                        <div className="relative w-14 h-14 flex items-center justify-center shrink-0">
                          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                            <path
                              className="text-slate-700"
                              strokeWidth="3"
                              stroke="currentColor"
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                            <path
                              className="text-emerald-500 transition-all duration-1000 ease-out"
                              strokeDasharray={`${wordProgress}, 100`}
                              strokeWidth="3"
                              strokeLinecap="round"
                              stroke="currentColor"
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                          </svg>
                          <span className={`absolute text-xs font-bold ${theme === 'theme-hc-light' ? 'text-emerald-600' : 'text-emerald-400'}`}>{Math.round(wordProgress)}%</span>
                        </div>
                        <div>
                          <h4 className={`text-sm font-semibold ${theme === 'theme-hc-light' ? 'text-gray-800' : 'text-slate-200'}`}>Daily Word Goal</h4>
                          <p className={`text-xs ${theme === 'theme-hc-light' ? 'text-gray-500' : 'text-slate-400'}`}>{todayWords} / {wordGoal} words</p>
                        </div>
                      </div>

                      {/* Mood Line Chart */}
                      <div className={`p-5 rounded-2xl border ${theme === 'theme-hc-light' ? 'bg-white border-gray-200' : 'bg-slate-900 border-slate-800'} h-24 flex flex-col justify-center`}>
                        <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 ${theme === 'theme-hc-light' ? 'text-gray-500' : 'text-slate-500'}`}>Mood Frequency (30d)</h4>
                        {moodChartData.length > 0 ? (
                          <div className="h-full w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={moodChartData}>
                                <RechartsTooltip 
                                  contentStyle={{ backgroundColor: theme === 'theme-hc-light' ? '#fff' : '#1e293b', border: 'none', borderRadius: '8px', fontSize: '12px' }}
                                />
                                <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        ) : (
                          <div className={`text-xs ${theme === 'theme-hc-light' ? 'text-gray-400' : 'text-slate-600'}`}>Not enough data</div>
                        )}
                      </div>
                    </div>

                    {/* Reflections Overview */}
                    <div className={`mb-6 p-6 rounded-2xl border ${theme === 'theme-hc-light' ? 'bg-emerald-50/50 border-emerald-100' : 'bg-slate-900/50 border-slate-800'}`}>
                      <div className="flex justify-between items-start mb-3">
                        <h3 className={`text-sm font-bold uppercase tracking-widest ${theme === 'theme-hc-light' ? 'text-emerald-700' : 'text-emerald-500'}`}>Your Personalized Journal</h3>
                        <button 
                          onClick={generateOverview} 
                          disabled={loadingOverview}
                          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${theme === 'theme-hc-light' ? 'bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'}`}
                        >
                          {loadingOverview ? 'Generating...' : 'Generate AI Summary'}
                        </button>
                      </div>
                      {overview ? (
                        <p className={`text-sm leading-relaxed ${theme === 'theme-hc-light' ? 'text-gray-700' : 'text-slate-300'}`}>{overview}</p>
                      ) : (
                        <p className={`text-sm italic ${theme === 'theme-hc-light' ? 'text-gray-500' : 'text-slate-500'}`}>Click to generate a weekly summary of your recurring themes based on "Personal" or "Ideas" tags.</p>
                      )}
                    </div>
                    
                    {/* Batch Tagging Controls */}
                    <div className="flex items-center gap-4 mb-4">
                      <button
                        onClick={() => {
                          setIsBatchMode(!isBatchMode);
                          if (isBatchMode) setSelectedBatchIds(new Set());
                        }}
                        className={`text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
                          isBatchMode 
                            ? 'bg-emerald-500 text-white border-emerald-500'
                            : (theme === 'theme-hc-light' ? 'bg-white text-gray-600 border-gray-300' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700')
                        }`}
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                        {isBatchMode ? 'Cancel Batch Selection' : 'Batch Tagging'}
                      </button>

                      {isBatchMode && selectedBatchIds.size > 0 && (
                        <div className="flex items-center gap-2">
                          <input 
                            type="text" 
                            placeholder="New Tag..." 
                            value={batchTag}
                            onChange={e => setBatchTag(e.target.value)}
                            className={`w-32 text-xs px-2 py-1.5 rounded-md border focus:outline-none focus:border-emerald-500 ${theme === 'theme-hc-light' ? 'bg-white border-gray-300 text-black' : 'bg-slate-900 border-slate-700 text-white'}`}
                          />
                          <button 
                            onClick={applyBatchTag}
                            className="bg-emerald-500 text-white text-xs px-3 py-1.5 rounded-md hover:bg-emerald-600 transition-colors flex items-center gap-1"
                          >
                            <Tag className="w-3.5 h-3.5" /> Apply to {selectedBatchIds.size}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Tags Filter */}
                    {allTags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-6">
                        <button
                          onClick={() => setSelectedFilterTag(null)}
                          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                            !selectedFilterTag 
                              ? (theme === 'theme-hc-light' ? 'bg-black text-white border-black' : 'bg-emerald-500 text-white border-emerald-500') 
                              : (theme === 'theme-hc-light' ? 'bg-white text-gray-600 border-gray-300 hover:border-gray-400' : 'bg-transparent text-slate-400 border-slate-700 hover:border-slate-500')
                          }`}
                        >
                          All Entries
                        </button>
                        {allTags.map(tag => (
                          <button
                            key={tag}
                            onClick={() => setSelectedFilterTag(tag === selectedFilterTag ? null : tag)}
                            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                              selectedFilterTag === tag
                                ? 'bg-emerald-500 text-white border-emerald-500' 
                                : (theme === 'theme-hc-light' ? 'bg-white text-gray-600 border-gray-300 hover:border-emerald-300' : 'bg-transparent text-slate-400 border-slate-700 hover:border-emerald-500/50')
                            }`}
                          >
                            #{tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {filteredJournals.length === 0 ? (
                    <div className={`text-center p-16 rounded-2xl border border-dashed ${theme === 'theme-hc-light' ? 'bg-white border-gray-300' : 'bg-[#111111] border-slate-800'}`}>
                      <Book className={`w-12 h-12 mx-auto mb-4 ${theme === 'theme-hc-light' ? 'text-gray-400' : 'text-slate-700'}`} />
                      <h3 className={`text-lg font-medium mb-1 ${theme === 'theme-hc-light' ? 'text-gray-900' : 'text-slate-300'}`}>No reflections found</h3>
                      <p className={`${theme === 'theme-hc-light' ? 'text-gray-500' : 'text-slate-500'} mb-6`}>
                        {searchQuery || selectedFilterTag ? 'Try adjusting your search or filters.' : 'Start your first journal entry to begin.'}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-6 relative">
                      {/* Timeline Line */}
                      <div className={`absolute left-8 top-4 bottom-0 w-px ${theme === 'theme-hc-light' ? 'bg-gray-200' : 'bg-slate-800'} hidden sm:block z-0`}></div>
                      
                      {filteredJournals.map((journal, index) => (
                        <motion.div 
                          key={journal.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          onClick={() => setSelectedJournal(journal)}
                          className={`relative flex flex-col sm:flex-row gap-4 sm:gap-6 group cursor-pointer`}
                        >
                          {/* Timeline Node */}
                          <div className="hidden sm:flex flex-col items-center z-10 pt-4">
                            <div className={`w-16 text-right text-xs font-bold uppercase tracking-widest ${theme === 'theme-hc-light' ? 'text-gray-400' : 'text-slate-500'}`}>
                              {journal.createdAt ? format(new Date((journal.createdAt as any)?.toDate?.() || journal.createdAt), 'MMM d') : ''}
                            </div>
                            <div className={`w-3 h-3 rounded-full mt-2 transition-colors ${theme === 'theme-hc-light' ? 'bg-gray-300 group-hover:bg-emerald-500' : 'bg-slate-700 group-hover:bg-emerald-500'}`}></div>
                          </div>
                          
                          {/* Entry Card */}
                          <div className={`flex-1 p-6 rounded-2xl border transition-all relative ${
                            theme === 'theme-hc-light' 
                              ? (selectedBatchIds.has(journal.id!) ? 'bg-emerald-50 border-emerald-300 shadow-md' : 'bg-white border-gray-200 hover:border-gray-300 shadow-sm hover:shadow-md')
                              : (selectedBatchIds.has(journal.id!) ? 'bg-slate-800 border-emerald-500/50' : (theme === 'theme-hc-dark' ? 'bg-black border-slate-800 hover:border-slate-600' : 'bg-[#111111] border-slate-800/80 hover:border-slate-700 hover:bg-slate-800/30'))
                          }`}>
                            <div className="flex justify-between items-start mb-3">
                              <div>
                                <h3 className={`font-semibold text-xl mb-1 ${theme === 'theme-hc-light' ? 'text-black' : 'text-slate-200'}`}>
                                  {journal.mood && <span className="mr-2 text-xl">{journal.mood}</span>}
                                  {journal.title}
                                </h3>
                                <div className={`text-xs sm:hidden mb-2 font-medium ${theme === 'theme-hc-light' ? 'text-gray-500' : 'text-slate-500'}`}>
                                  {journal.createdAt ? format(new Date((journal.createdAt as any)?.toDate?.() || journal.createdAt), 'MMM d, yyyy') : ''}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {isBatchMode && (
                                  <button
                                    onClick={(e) => toggleBatchSelection(journal.id!, e)}
                                    className={`${selectedBatchIds.has(journal.id!) ? 'text-emerald-500' : (theme === 'theme-hc-light' ? 'text-gray-300 hover:text-emerald-400' : 'text-slate-600 hover:text-emerald-400')}`}
                                  >
                                    <CheckCircle2 className={`w-6 h-6 ${selectedBatchIds.has(journal.id!) ? 'fill-emerald-500/20' : ''}`} />
                                  </button>
                                )}
                                {!isBatchMode && (
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteJournal(journal.id!, e);
                                    }}
                                    className={`p-1.5 opacity-0 group-hover:opacity-100 rounded-lg transition-all ${
                                      theme === 'theme-hc-light' ? 'text-gray-400 hover:text-red-500 hover:bg-red-50' : 'text-slate-600 hover:text-red-400 hover:bg-red-500/10'
                                    }`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                            
                            {journal.summary ? (
                              <p className={`text-sm leading-relaxed line-clamp-3 mb-4 ${theme === 'theme-hc-light' ? 'text-gray-600' : 'text-slate-400'}`}>
                                {journal.summary}
                              </p>
                            ) : (
                              <p className={`text-sm italic mb-4 ${theme === 'theme-hc-light' ? 'text-gray-400' : 'text-slate-600'}`}>
                                No summary generated yet. Chat to generate one.
                              </p>
                            )}

                            {journal.images && journal.images.length > 0 && (
                              <div className="w-full mb-4">
                                {journal.images.map((img, idx) => (
                                  <img 
                                    key={idx} 
                                    src={img} 
                                    alt="attached" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setViewImage(img);
                                    }}
                                    className="w-full h-auto max-h-[300px] object-cover rounded-xl border border-slate-700/50 flex-shrink-0 bg-slate-900/50 cursor-pointer hover:opacity-90 transition-opacity" 
                                  />
                                ))}
                              </div>
                            )}

                            {journal.tags && journal.tags.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {journal.tags.map(tag => (
                                  <span key={tag} className={`text-[10px] px-2 py-0.5 rounded font-medium uppercase tracking-wider ${
                                    theme === 'theme-hc-light' ? 'bg-gray-100 text-gray-600' : 'bg-slate-800/50 text-slate-400 border border-slate-700'
                                  }`}>
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
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
