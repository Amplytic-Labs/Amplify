import { useState, useEffect } from 'react';
import { memoryStore, type Memory } from '~/lib/persistence/memoryStore';
import { toast } from '~/components/ui/toast';

export default function MemoryTab() {
  const [memories, setMemories] = useState<Memory[]>([]);

  useEffect(() => {
    setMemories(memoryStore.getMemories());
  }, []);

  const handleDelete = (id: string) => {
    if (memoryStore.deleteMemory(id)) {
      setMemories(memoryStore.getMemories());
      toast.success('Memory deleted');
    } else {
      toast.error('Failed to delete memory');
    }
  };

  const handleClearAll = () => {
    if (confirm('Are you sure you want to clear all memories?')) {
      memoryStore.clearAll();
      setMemories([]);
      toast.success('All memories cleared');
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">User Memory</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Facts the AI has learned about you across sessions.
          </p>
        </div>
        <button
          onClick={handleClearAll}
          className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 dark:bg-red-900/20 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
        >
          Clear All
        </button>
      </div>

      {memories.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
          <div className="i-ph:brain-light text-4xl text-gray-300 dark:text-gray-700 mb-3" />
          <p className="text-gray-500 dark:text-gray-400">No memories stored yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {memories.map((memory) => (
            <div
              key={memory.id}
              className="flex items-center justify-between p-4 bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm group hover:border-blue-500/30 transition-all"
            >
              <div className="flex-1 pr-4">
                <div className="flex items-center gap-2 mb-1">
                  {memory.category && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">
                      {memory.category}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                    {new Date(memory.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300">{memory.content}</p>
              </div>
              <button
                onClick={() => handleDelete(memory.id)}
                className="bg-transparent p-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                title="Delete memory"
              >
                <div className="i-ph:trash text-lg" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
