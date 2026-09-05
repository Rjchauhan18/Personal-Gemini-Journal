import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { LogIn } from 'lucide-react';
import { motion } from 'motion/react';

export default function Login() {
  const { signIn } = useAuth();
  const [error, setError] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setError('');
    try {
      await signIn();
    } catch (err: any) {
      console.error(err);
      setError('Failed to sign in. Please try again.');
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-4 font-sans text-slate-100">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-[#111111] rounded-2xl shadow-lg border border-slate-800 p-8 text-center"
      >
        <div className="w-16 h-16 bg-emerald-900/20 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <div className="w-6 h-6 bg-emerald-500 rounded-sm rotate-45 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <LogIn className="w-3.5 h-3.5 text-[#0a0a0a] -rotate-45" />
          </div>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Reflect.ai</h1>
        <p className="text-slate-500 mb-8 uppercase tracking-widest text-xs">Private Journal & AI</p>
        
        {error && <p className="text-red-400 text-sm mb-4 bg-red-900/10 p-2 rounded border border-red-900/50">{error}</p>}
        
        <button 
          onClick={handleSignIn}
          disabled={isSigningIn}
          className="w-full bg-emerald-600 text-white rounded-xl py-3 px-4 font-medium hover:bg-emerald-500 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
        </button>
      </motion.div>
    </div>
  );
}
