import fs from 'fs';
let content = fs.readFileSync('src/components/JournalChat.tsx', 'utf8');

const badHeader = `<div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            
        </div>

        {/* Tags Section */}`;

const goodHeader = `<div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className={\`p-2 rounded-full transition-colors \${theme === 'theme-hc-light' ? 'hover:bg-gray-100' : 'hover:bg-slate-800'}\`}>
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

        {/* Tags Section */}`;

content = content.replace(badHeader, goodHeader);

const badAnimate = `<AnimatePresence>
        <AnimatePresence>`;

const goodAnimate = `<AnimatePresence>`;

content = content.replace(badAnimate, goodAnimate);

fs.writeFileSync('src/components/JournalChat.tsx', content);
