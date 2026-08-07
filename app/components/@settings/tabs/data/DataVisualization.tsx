import { useState, useEffect } from 'react';
import type { Chat } from '~/lib/persistence/chats';
import type { UIMessage } from 'ai';
import { classNames } from '~/utils/classNames';

type DataVisualizationProps = {
  chats: Chat[];
};

export function DataVisualization({ chats }: DataVisualizationProps) {
  const [chatsByDate, setChatsByDate] = useState<Record<string, number>>({});
  const [messagesByRole, setMessagesByRole] = useState<Record<string, number>>({});
  const [apiKeyUsage, setApiKeyUsage] = useState<Array<{ provider: string; count: number }>>([]);
  const [averageMessagesPerChat, setAverageMessagesPerChat] = useState<number>(0);
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    setIsDarkMode(isDark);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          setIsDarkMode(document.documentElement.classList.contains('dark'));
        }
      });
    });

    observer.observe(document.documentElement, { attributes: true });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const chatsByDay: Record<string, number> = {};
    const roleCount: Record<string, number> = {};
    const providerCount: Record<string, number> = {};
    let totalMessages = 0;

    chats.forEach((chat) => {
      const date = new Date(chat.timestamp).toLocaleDateString();
      chatsByDay[date] = (chatsByDay[date] || 0) + 1;

      if (chat.messages) {
        chat.messages.forEach((msg: UIMessage) => {
          const role = msg.role;
          roleCount[role] = (roleCount[role] || 0) + 1;
          totalMessages++;

          const meta = msg.metadata as Record<string, unknown> | undefined;

          if (meta?.provider) {
            providerCount[meta.provider as string] = (providerCount[meta.provider as string] || 0) + 1;
          }
        });
      }
    });

    setChatsByDate(chatsByDay);
    setMessagesByRole(roleCount);
    setApiKeyUsage(
      Object.entries(providerCount)
        .map(([provider, count]) => ({ provider, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    );
    setAverageMessagesPerChat(chats.length > 0 ? totalMessages / chats.length : 0);
  }, [chats]);

  // Lazy-loaded chart components — only loaded when actually rendered
  const [chartComponents, setChartComponents] = useState<{
    Bar: React.ComponentType<any>;
    Pie: React.ComponentType<any>;
  } | null>(null);

  useEffect(() => {
    if (chartComponents) {
      return;
    }

    Promise.all([import('chart.js'), import('react-chartjs-2')]).then(([chartMod, reactChartMod]) => {
      const {
        Chart: chartJs,
        CategoryScale,
        LinearScale,
        BarElement,
        Title,
        Tooltip,
        Legend,
        ArcElement,
        PointElement,
        LineElement,
      } = chartMod;

      chartJs.register(
        CategoryScale,
        LinearScale,
        BarElement,
        Title,
        Tooltip,
        Legend,
        ArcElement,
        PointElement,
        LineElement,
      );

      setChartComponents({
        Bar: reactChartMod.Bar,
        Pie: reactChartMod.Pie,
      });
    });
  }, [chartComponents]);

  // Placeholder while chart.js is loading
  if (!chartComponents) {
    return (
      <div className="flex items-center justify-center h-64 text-amplify-elements-textTertiary">Loading charts…</div>
    );
  }

  const { Bar, Pie } = chartComponents;

  const chartData = {
    history: {
      labels: Object.keys(chatsByDate).slice(-7),
      datasets: [
        {
          label: 'Chats per day',
          data: Object.values(chatsByDate).slice(-7),
          backgroundColor: isDarkMode ? 'rgba(99, 102, 241, 0.8)' : 'rgba(79, 70, 229, 0.8)',
          borderColor: isDarkMode ? 'rgb(129, 140, 248)' : 'rgb(67, 56, 202)',
          borderWidth: 1,
        },
      ],
    },
    roles: {
      labels: Object.keys(messagesByRole),
      datasets: [
        {
          data: Object.values(messagesByRole),
          backgroundColor: [
            isDarkMode ? 'rgba(99, 102, 241, 0.8)' : 'rgba(79, 70, 229, 0.8)',
            isDarkMode ? 'rgba(16, 185, 129, 0.8)' : 'rgba(5, 150, 105, 0.8)',
            isDarkMode ? 'rgba(245, 158, 11, 0.8)' : 'rgba(217, 119, 6, 0.8)',
          ],
        },
      ],
    },
    apiUsage: {
      labels: apiKeyUsage.map((u) => u.provider),
      datasets: [
        {
          data: apiKeyUsage.map((u) => u.count),
          backgroundColor: [
            isDarkMode ? 'rgba(99, 102, 241, 0.8)' : 'rgba(79, 70, 229, 0.8)',
            isDarkMode ? 'rgba(16, 185, 129, 0.8)' : 'rgba(5, 150, 105, 0.8)',
            isDarkMode ? 'rgba(245, 158, 11, 0.8)' : 'rgba(217, 119, 6, 0.8)',
            isDarkMode ? 'rgba(239, 68, 68, 0.8)' : 'rgba(185, 28, 28, 0.8)',
            isDarkMode ? 'rgba(139, 92, 246, 0.8)' : 'rgba(109, 40, 217, 0.8)',
          ],
        },
      ],
    },
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: {
        grid: { color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' },
        ticks: { color: isDarkMode ? '#e2e8f0' : '#475569' },
      },
      y: {
        grid: { color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' },
        ticks: { color: isDarkMode ? '#e2e8f0' : '#475569' },
      },
    },
  };

  const pieOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { color: isDarkMode ? '#e2e8f0' : '#475569' },
      },
    },
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div
          className={classNames(
            'rounded-lg border p-4',
            isDarkMode
              ? 'bg-amplify-elements-background-depth-2 border-amplify-elements-borderColor'
              : 'bg-white border-gray-200',
          )}
        >
          <h3 className="text-sm font-medium mb-4 text-amplify-elements-textPrimary">Chat Activity</h3>
          <div className="h-64">
            <Bar data={chartData.history} options={chartOptions} />
          </div>
        </div>

        <div
          className={classNames(
            'rounded-lg border p-4',
            isDarkMode
              ? 'bg-amplify-elements-background-depth-2 border-amplify-elements-borderColor'
              : 'bg-white border-gray-200',
          )}
        >
          <h3 className="text-sm font-medium mb-4 text-amplify-elements-textPrimary">Messages by Role</h3>
          <div className="h-64 flex items-center justify-center">
            <Pie data={chartData.roles} options={pieOptions} />
          </div>
        </div>

        {apiKeyUsage.length > 0 && (
          <div
            className={classNames(
              'rounded-lg border p-4 md:col-span-2',
              isDarkMode
                ? 'bg-amplify-elements-background-depth-2 border-amplify-elements-borderColor'
                : 'bg-white border-gray-200',
            )}
          >
            <h3 className="text-sm font-medium mb-4 text-amplify-elements-textPrimary">API Provider Usage</h3>
            <div className="h-64 flex items-center justify-center">
              <Pie data={chartData.apiUsage} options={pieOptions} />
            </div>
          </div>
        )}
      </div>

      <div
        className={classNames(
          'rounded-lg border p-4',
          isDarkMode
            ? 'bg-amplify-elements-background-depth-2 border-amplify-elements-borderColor'
            : 'bg-white border-gray-200',
        )}
      >
        <h3 className="text-sm font-medium mb-2 text-amplify-elements-textPrimary">Statistics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-amplify-elements-textTertiary">Total Chats</p>
            <p className="text-lg font-semibold text-amplify-elements-textPrimary">{chats.length}</p>
          </div>
          <div>
            <p className="text-xs text-amplify-elements-textTertiary">Avg Messages/Chat</p>
            <p className="text-lg font-semibold text-amplify-elements-textPrimary">
              {averageMessagesPerChat.toFixed(1)}
            </p>
          </div>
          <div>
            <p className="text-xs text-amplify-elements-textTertiary">Total Messages</p>
            <p className="text-lg font-semibold text-amplify-elements-textPrimary">
              {Object.values(messagesByRole).reduce((a, b) => a + b, 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-amplify-elements-textTertiary">Providers Used</p>
            <p className="text-lg font-semibold text-amplify-elements-textPrimary">{apiKeyUsage.length}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
