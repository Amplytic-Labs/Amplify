import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import { STARTER_TEMPLATES } from '~/utils/constants';

export function TemplatesModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  
  if (!isOpen) return null;

  const filteredItems = STARTER_TEMPLATES.filter(item => 
    item.label.toLowerCase().includes(searchQuery.toLowerCase()) || 
    item.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-sidebar border border-sidebar-border rounded-2xl shadow-2xl w-full max-w-[500px] max-h-[85vh] flex flex-col overflow-hidden ring-1 ring-white/10 transform transition-all">
        
        {/* Header with gradient effect */}
        <div className="relative flex items-center justify-between px-6 py-5 border-b border-sidebar-border bg-sidebar-accent/30 overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent"></div>
          <h2 className="text-xl font-bold text-sidebar-foreground tracking-tight flex items-center gap-2">
            Templates
          </h2>
          <button 
            onClick={onClose} 
            className="p-2 rounded-full bg-sidebar hover:bg-sidebar-accent/80 border border-sidebar-border text-muted-foreground hover:text-sidebar-foreground transition-all shadow-sm"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-5 border-b border-sidebar-border bg-sidebar-accent/10">
          <div className="relative group">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-emerald-500 transition-colors" />
            <input 
              type="text" 
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-sidebar border border-sidebar-border rounded-xl pl-11 pr-4 py-3 text-[15px] text-sidebar-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all shadow-inner"
            />
          </div>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-3 bg-sidebar/50 custom-scrollbar">
          {filteredItems.length > 0 ? (
            <div className="flex flex-col gap-2">
              {filteredItems.map((item, idx) => (
                <a 
                  key={idx} 
                  href={`/git?url=https://github.com/${item.githubRepo}.git`}
                  className="w-full flex items-center gap-4 px-4 py-4 rounded-xl bg-sidebar border border-sidebar-border hover:border-emerald-500/30 hover:bg-sidebar-accent shadow-sm transition-all text-left group"
                >
                  <div className="w-10 h-10 rounded-lg bg-sidebar-accent border border-sidebar-border flex items-center justify-center shrink-0 group-hover:bg-emerald-500/10 group-hover:text-emerald-500 group-hover:border-emerald-500/20 transition-all">
                    <div className={`inline-block ${item.icon} w-6 h-6 text-muted-foreground group-hover:text-emerald-500 transition-colors`} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[15px] text-sidebar-foreground font-semibold tracking-tight">{item.label}</span>
                    <span className="text-[13px] text-muted-foreground line-clamp-2">{item.description}</span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="px-8 py-12 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-full bg-sidebar-accent flex items-center justify-center mb-4 border border-sidebar-border">
                <Search size={24} className="text-muted-foreground/50" />
              </div>
              <p className="text-[15px] font-medium text-sidebar-foreground">No matches found</p>
              <p className="text-[13px] text-muted-foreground mt-1">We couldn't find anything matching "{searchQuery}"</p>
            </div>
          )}
        </div>
        
        {/* Footer actions */}
        <div className="p-4 border-t border-sidebar-border bg-sidebar-accent/10 flex justify-end">
          <button 
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors shadow-md"
          >
            Create Blank
          </button>
        </div>
      </div>
    </div>
  );
}
