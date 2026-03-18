'use client';

import { useState, useEffect, useRef } from 'react';

// --- Helper Types ---
type Message = {
  role: 'user' | 'assistant';
  content: string;
};

// --- Main Component ---
export default function WaiterInteraction() {
  // --- State Management ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // --- Auto-scroll to latest message ---
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);


  // --- Core Logic: Handle message submission and stream response ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Prepare the body for the Cloud Function
    const requestBody = {
      history: messages,
      prompt: input,
    };

    try {
      // --- BACKEND CONNECTION ---
      // This is where we connect to your Google Cloud Function.
      // We will replace this with an environment variable later.
      const API_URL = 'https://handle-waiter-interaction-xqhpwhjfha-ey.a.run.app'; 

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.body) {
        throw new Error('Response body is missing');
      }

      // --- STREAMING LOGIC ---
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantResponse = '';
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        assistantResponse += chunk;

        // Update the last message (the assistant's) with the new chunk
        setMessages((prev) => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1].content = assistantResponse;
          return newMessages;
        });
      }
    } catch (error) {
      console.error('Error fetching stream:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Przepraszam, mam problem z połączeniem. Spróbuj ponownie.',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // --- UI Rendering ---
  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white font-sans">
      {/* Header */}
      <header className="bg-gray-800 p-4 shadow-md">
        <h1 className="text-xl font-bold text-yellow-400">Wirtualny Kelner AI</h1>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg, index) => (
          <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-lg px-4 py-2 rounded-lg shadow ${
                msg.role === 'user'
                  ? 'bg-blue-600 rounded-br-none'
                  : 'bg-gray-700 rounded-bl-none'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Form */}
      <footer className="bg-gray-800 p-4">
        <form onSubmit={handleSubmit} className="flex items-center space-x-4">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isLoading ? 'Kelner myśli...' : 'Napisz wiadomość...'}
            disabled={isLoading}
            className="flex-1 p-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-6 py-3 bg-yellow-500 font-semibold rounded-lg hover:bg-yellow-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            Wyślij
          </button>
        </form>
      </footer>
    </div>
  );
}
