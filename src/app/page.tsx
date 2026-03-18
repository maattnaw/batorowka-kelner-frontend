'use client';

import { useState, useEffect, useRef } from 'react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  options?: string[];
};

export default function WaiterInteraction() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSessionId('table-' + Math.random().toString(36).substring(2, 9));
    setMessages([{ role: 'assistant', content: 'Benvenuti! Jestem Wirtualnym Kelnerem Fresca Napoli. W czym mogę pomóc?', options: ["Menu", "Wezwij Kelnera", "Rachunek"] }]);
  }, []);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(scrollToBottom, [messages]);

  const sendMessageToBackend = async (text: string) => {
    if (!text.trim() || isLoading) return;
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('https://handle-waiter-interaction-xqhpwhjfha-ey.a.run.app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_id: sessionId, message: text, payload: {} }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let assistantResponse = '';
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkText = decoder.decode(value, { stream: true });
        const lines = chunkText.split('\n');

        for (const line of lines) {
          if (line.trim().startsWith('data: ')) {
            try {
              const dataObj = JSON.parse(line.trim().substring(6));
              
              if (dataObj.type === 'chunk' && dataObj.text) {
                assistantResponse += dataObj.text;
                setMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1].content = assistantResponse;
                  return newMessages;
                });
              } else if (dataObj.type === 'end') {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1].options = dataObj.options || [];
                  return newMessages;
                });
              }
            } catch (e) {
              console.error("Parse error:", e);
            }
          }
        }
      }
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Błąd połączenia z kelnerem.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen text-white bg-black">
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`p-3 rounded-lg ${msg.role === 'user' ? 'bg-yellow-600' : 'bg-gray-800'}`}>
              {msg.content}
            </div>
            {msg.options && (
              <div className="flex flex-wrap gap-2 mt-2">
                {msg.options.map((opt, j) => (
                  <button key={j} onClick={() => sendMessageToBackend(opt)} className="px-3 py-1 bg-gray-700 rounded-full text-sm hover:bg-yellow-600">{opt}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>
      <form onSubmit={(e) => { e.preventDefault(); sendMessageToBackend(input); }} className="p-4 border-t border-gray-800">
        <input value={input} onChange={(e) => setInput(e.target.value)} className="w-full p-2 bg-gray-900 rounded" />
      </form>
    </div>
  );
}
