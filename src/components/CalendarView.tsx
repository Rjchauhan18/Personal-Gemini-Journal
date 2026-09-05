import React from 'react';
import { JournalEntry } from '../types';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, startOfWeek, endOfWeek, addMonths, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

interface CalendarViewProps {
  theme?: string;
  journals: JournalEntry[];
  onSelectJournal: (journal: JournalEntry) => void;
  selectedJournalId?: string;
}

export default function CalendarView({ journals, onSelectJournal, selectedJournalId, theme = "theme-default" }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = React.useState(new Date());

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const dateFormat = "MMMM yyyy";
  const days = eachDayOfInterval({
    start: startDate,
    end: endDate
  });

  const nextMonth = () => {
    setCurrentDate(addMonths(currentDate, 1));
  };

  const prevMonth = () => {
    setCurrentDate(subMonths(currentDate, 1));
  };

  const getJournalsForDate = (date: Date) => {
    return journals.filter(journal => {
      const journalDate = journal.createdAt ? new Date((journal.createdAt as any)?.toDate?.() || journal.createdAt) : new Date();
      return isSameDay(journalDate, date);
    });
  };

  return (
    <div className={`h-full w-full p-8 overflow-y-auto flex flex-col items-center ${theme === "theme-hc-light" ? "bg-white text-black" : "bg-[#0a0a0a] text-slate-100"}`}>
      <div className="max-w-4xl w-full flex flex-col items-center mt-10">
        <div className="flex items-center gap-3 text-emerald-400 mb-6">
          <CalendarIcon className="w-8 h-8" />
          <h1 className="text-3xl font-bold tracking-tight">Your Reflection Calendar</h1>
        </div>
        
        <p className={`text-center max-w-xl mb-12 ${theme === "theme-hc-light" ? "text-gray-500" : "text-slate-400"}`}>
          Track your emotional journey over time. Click on any date with a mood icon to jump straight into that day's reflection.
        </p>

        <div className={`w-full border rounded-2xl p-6 shadow-2xl ${theme === "theme-hc-light" ? "bg-gray-50 border-gray-200" : "bg-[#111111] border-slate-800"}`}>
          <div className="flex justify-between items-center mb-6 px-2">
            <button 
              onClick={prevMonth}
              className={`p-2 rounded-full transition-colors ${theme === "theme-hc-light" ? "hover:bg-gray-200 text-gray-500 hover:text-gray-900" : "hover:bg-slate-800 text-slate-400 hover:text-white"}`}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <h2 className={`text-xl font-semibold ${theme === "theme-hc-light" ? "text-gray-900" : "text-slate-200"}`}>
              {format(currentDate, dateFormat)}
            </h2>
            <button 
              onClick={nextMonth}
              className={`p-2 rounded-full transition-colors ${theme === "theme-hc-light" ? "hover:bg-gray-200 text-gray-500 hover:text-gray-900" : "hover:bg-slate-800 text-slate-400 hover:text-white"}`}
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className={`text-center text-sm font-medium py-2 ${theme === "theme-hc-light" ? "text-gray-500" : "text-slate-500"}`}>
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {days.map((day, idx) => {
              const dayJournals = getJournalsForDate(day);
              const isCurrentMonth = isSameMonth(day, monthStart);
              const isToday = isSameDay(day, new Date());
              const hasEntries = dayJournals.length > 0;
              // For simplicity, just grab the most recent journal of that day (which is the first one in the sorted list usually)
              const primaryJournal = hasEntries ? dayJournals[0] : null;

              return (
                <div 
                  key={day.toString()} 
                  onClick={() => {
                    if (primaryJournal) {
                      onSelectJournal(primaryJournal);
                    }
                  }}
                  className={`
                    min-h-[80px] p-2 rounded-xl flex flex-col items-center justify-start border transition-all
                    ${!isCurrentMonth ? 'opacity-30' : ''}
                    ${hasEntries 
                      ? (theme === 'theme-hc-light' 
                          ? 'bg-emerald-50/50 border-emerald-100 cursor-pointer hover:bg-emerald-100 group' 
                          : 'bg-slate-800/40 border-slate-700/50 cursor-pointer hover:bg-slate-800 hover:border-emerald-500/50 group') 
                      : 'bg-transparent border-transparent'}
                    ${isToday && !hasEntries ? (theme === 'theme-hc-light' ? 'border-gray-300' : 'border-slate-800') : ''}
                  `}
                >
                  <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full mb-1
                    ${isToday 
                       ? (theme === 'theme-hc-light' ? 'bg-emerald-600 text-white' : 'bg-emerald-500 text-slate-900') 
                       : (theme === 'theme-hc-light' ? 'text-gray-600 group-hover:text-gray-900' : 'text-slate-400 group-hover:text-slate-200')}
                  `}>
                    {format(day, 'd')}
                  </span>
                  
                  {hasEntries && (
                    <div className="flex gap-1 flex-wrap justify-center mt-1">
                      {dayJournals.map(j => (
                        <div 
                          key={j.id} 
                          className={`w-8 h-8 flex items-center justify-center border rounded-full shadow-sm text-lg ${theme === 'theme-hc-light' ? 'bg-white border-gray-200' : 'bg-slate-900 border-slate-700'}`}
                          title={j.title}
                        >
                          {j.mood || '📝'}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
