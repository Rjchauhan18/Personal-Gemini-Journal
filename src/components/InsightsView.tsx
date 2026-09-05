import React, { useState } from 'react';
import { motion } from 'motion/react';
import { JournalEntry } from '../types';
import { useAuth } from '../AuthContext';
import { Brain, Sparkles, Clock, ArrowRight, Loader2, RefreshCw } from 'lucide-react';

interface InsightsViewProps {
  journals: JournalEntry[];
  theme: string;
}

export default function InsightsView({ journals, theme }: InsightsViewProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'patterns' | 'time-capsule'>('patterns');
  const [insightData, setInsightData] = useState<any>(null);
  const [error, setError] = useState('');

  const fetchInsights = async (action: string, payload: any) => {
    if (!user) return;
    setLoading(true);
    setError('');
    setInsightData(null);
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
      
      if (!response.ok) throw new Error('Failed to fetch insights');
      const data = await response.json();
      setInsightData(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred while generating insights.');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzePatterns = () => {
    const recent = journals.slice(0, 30); // up to 30 days
    fetchInsights('analyze_patterns', { entries: recent.map(j => ({ date: j.createdAt, summary: j.summary, tags: j.tags, mood: j.mood })) });
  };

  const handleTimeCapsule = () => {
    if (journals.length < 2) {
      setError('Not enough entries for a time capsule. Keep journaling!');
      return;
    }
    const recent = journals.slice(0, 7).map(j => ({ date: j.createdAt, summary: j.summary, tags: j.tags, mood: j.mood }));
    const oldest = journals[journals.length - 1];
    
    fetchInsights('time_capsule_compare', { 
      old_entry: { date: oldest.createdAt, summary: oldest.summary, tags: oldest.tags, mood: oldest.mood }, 
      recent_entries: recent 
    });
  };

  const isLight = theme === 'theme-hc-light';

  return (
    <div className={`h-full overflow-y-auto p-4 md:p-8 ${isLight ? 'text-gray-900' : 'text-slate-200'}`}>
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-serif mb-2 flex items-center gap-3">
            <Brain className="w-8 h-8 text-indigo-500" />
            AI Insights
          </h1>
          <p className={isLight ? 'text-gray-600' : 'text-slate-400'}>
            Discover deep patterns and reflections on your mindfulness journey.
          </p>
        </header>

        <div className="flex gap-4 border-b border-slate-700/50 pb-4">
          <button
            onClick={() => { setActiveTab('patterns'); setInsightData(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'patterns' ? (isLight ? 'bg-indigo-100 text-indigo-700' : 'bg-indigo-500/20 text-indigo-400') : (isLight ? 'hover:bg-gray-100' : 'hover:bg-slate-800/50')}`}
          >
            <Sparkles className="w-4 h-4" />
            Pattern Analysis
          </button>
          <button
            onClick={() => { setActiveTab('time-capsule'); setInsightData(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'time-capsule' ? (isLight ? 'bg-indigo-100 text-indigo-700' : 'bg-indigo-500/20 text-indigo-400') : (isLight ? 'hover:bg-gray-100' : 'hover:bg-slate-800/50')}`}
          >
            <Clock className="w-4 h-4" />
            Time Capsule
          </button>
        </div>

        <div className="min-h-[300px]">
          {activeTab === 'patterns' && !insightData && !loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`p-8 rounded-2xl text-center ${isLight ? 'bg-white border-gray-200 shadow-sm' : 'bg-slate-800/30 border-slate-700/50'} border`}>
              <Sparkles className="w-12 h-12 mx-auto mb-4 text-indigo-400 opacity-50" />
              <h3 className="text-xl font-medium mb-2">Analyze Recent Patterns</h3>
              <p className={`mb-6 max-w-md mx-auto ${isLight ? 'text-gray-500' : 'text-slate-400'}`}>
                Let ReflectAI analyze your recent journal entries to identify recurring triggers, mood fluctuations, and coping mechanisms.
              </p>
              <button onClick={handleAnalyzePatterns} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors flex items-center gap-2 mx-auto">
                <RefreshCw className="w-4 h-4" /> Generate Analysis
              </button>
            </motion.div>
          )}

          {activeTab === 'time-capsule' && !insightData && !loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`p-8 rounded-2xl text-center ${isLight ? 'bg-white border-gray-200 shadow-sm' : 'bg-slate-800/30 border-slate-700/50'} border`}>
              <Clock className="w-12 h-12 mx-auto mb-4 text-indigo-400 opacity-50" />
              <h3 className="text-xl font-medium mb-2">Open Time Capsule</h3>
              <p className={`mb-6 max-w-md mx-auto ${isLight ? 'text-gray-500' : 'text-slate-400'}`}>
                Compare your oldest entry with your most recent ones to visualize your personal growth and shifting perspectives.
              </p>
              <button onClick={handleTimeCapsule} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors flex items-center gap-2 mx-auto">
                <RefreshCw className="w-4 h-4" /> Open Capsule
              </button>
            </motion.div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-20 opacity-50">
              <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
              <p>Analyzing your thoughts...</p>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl">
              {error}
            </div>
          )}

          {insightData && !loading && activeTab === 'patterns' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <div className={`p-6 rounded-2xl ${isLight ? 'bg-white border-gray-200 shadow-sm' : 'bg-slate-800/30 border-slate-700/50'} border`}>
                <h3 className="text-lg font-serif font-bold mb-4 flex items-center gap-2 text-indigo-400">
                  <Brain className="w-5 h-5" /> Executive Summary
                </h3>
                <p className="leading-relaxed text-lg">{insightData.insight_message}</p>
              </div>
              
              <div className="grid md:grid-cols-2 gap-6">
                <div className={`p-6 rounded-2xl ${isLight ? 'bg-white border-gray-200 shadow-sm' : 'bg-slate-800/30 border-slate-700/50'} border`}>
                  <h3 className="text-lg font-bold mb-4 text-amber-500 flex items-center gap-2">
                    Identified Patterns
                  </h3>
                  <ul className="space-y-3">
                    {insightData.identified_patterns?.map((pattern: string, i: number) => (
                      <li key={i} className="flex gap-3 items-start">
                        <ArrowRight className="w-5 h-5 shrink-0 text-amber-500/50 mt-0.5" />
                        <span className="leading-relaxed">{pattern}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className={`p-6 rounded-2xl ${isLight ? 'bg-white border-gray-200 shadow-sm' : 'bg-slate-800/30 border-slate-700/50'} border`}>
                  <h3 className="text-lg font-bold mb-4 text-emerald-500 flex items-center gap-2">
                    Growth Areas
                  </h3>
                  <ul className="space-y-3">
                    {insightData.growth_areas?.map((growth: string, i: number) => (
                      <li key={i} className="flex gap-3 items-start">
                        <Sparkles className="w-5 h-5 shrink-0 text-emerald-500/50 mt-0.5" />
                        <span className="leading-relaxed">{growth}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </motion.div>
          )}

          {insightData && !loading && activeTab === 'time-capsule' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
               <div className={`p-6 rounded-2xl ${isLight ? 'bg-white border-gray-200 shadow-sm' : 'bg-slate-800/30 border-slate-700/50'} border`}>
                <h3 className="text-lg font-serif font-bold mb-4 flex items-center gap-2 text-indigo-400">
                  <Clock className="w-5 h-5" /> Growth Narrative
                </h3>
                <p className="leading-relaxed text-lg">{insightData.growth_narrative}</p>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className={`p-6 rounded-2xl ${isLight ? 'bg-white border-gray-200 shadow-sm' : 'bg-slate-800/30 border-slate-700/50'} border`}>
                  <h3 className="text-lg font-bold mb-4 text-slate-400">Past Mindset</h3>
                  <p className="leading-relaxed opacity-80">{insightData.past_mindset}</p>
                </div>
                <div className={`p-6 rounded-2xl ${isLight ? 'bg-white border-gray-200 shadow-sm' : 'bg-slate-800/30 border-slate-700/50'} border`}>
                  <h3 className="text-lg font-bold mb-4 text-emerald-500">Current Mindset</h3>
                  <p className="leading-relaxed">{insightData.current_mindset}</p>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
