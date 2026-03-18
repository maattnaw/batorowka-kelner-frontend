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
  const [sessionId, setSessionId] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize Session ID
  useEffect(() => {
    // Prosty generator session_id na start
    const newSessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    setSessionId(newSessionId);
    
    // Opcjonalne: Przywitanie od kelnera przy starcie
    setMessages([
      { role: 'assistant', content: 'Dzień dobry! Jestem Wirtualnym Kelnerem Fresca Napoli. W czym mogę pomóc?' }
    ]);
  }, []);

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

    // Prepare the body for the Cloud Function WITH NEW PARAMS
    const requestBody = {
      history: messages,
      prompt: input,
      session_id: sessionId,
      action: 'message'
    };

    try {
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
        content: 'Przepraszam, mam problem z połączeniem z serwerem. Spróbuj ponownie za chwilę.',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // --- UI Rendering ---
  return (
    <div 
      className="flex flex-col h-screen text-white font-sans relative"
      style={{
        backgroundImage: "url('/fresca-bg.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat"
      }}
    >
      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-black/80 z-0"></div>

      {/* Content wrapper (above overlay) */}
      <div className="relative z-10 flex flex-col h-full max-w-3xl w-full mx-auto">
        
        {/* Header */}
        <header className="p-6 text-center border-b border-white/10">
          <h1 className="text-3xl font-light tracking-wide text-white uppercase mb-2" style={{ fontFamily: 'Georgia, serif' }}>
            Wirtualny Kelner
          </h1>
          <h2 className="text-xl text-[#D4AF37] tracking-widest uppercase mb-4" style={{ fontFamily: 'Georgia, serif' }}>
            Fresca Napoli
          </h2>
          <p className="text-sm text-gray-300 italic font-light">
            "Jeśli czegoś nie lubisz lub masz alergie, napisz w czacie"
          </p>
        </header>

        {/* Chat Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] md:max-w-[75%] px-5 py-3 rounded-2xl shadow-lg ${
                  msg.role === 'user'
                    ? 'bg-[#D4AF37]/90 text-black rounded-tr-sm font-medium'
                    : 'bg-zinc-900/80 border border-zinc-700/50 text-gray-100 rounded-tl-sm'
                }`}
              >
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </main>

        {/* Input Form */}
        <footer className="p-4 md:p-6 pb-8">
          <form onSubmit={handleSubmit} className="flex items-center space-x-3 bg-zinc-900/60 p-2 rounded-full border border-zinc-700/50 backdrop-blur-sm">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isLoading ? 'Kelner analizuje...' : 'Napisz swoją wiadomość...'}
              disabled={isLoading}
              className="flex-1 px-4 py-3 bg-transparent text-white placeholder-gray-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-6 py-3 bg-gradient-to-r from-[#C5A017] to-[#D4AF37] text-black font-semibold rounded-full hover:from-[#D4AF37] hover:to-[#F3E5AB] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_15px_rgba(212,175,55,0.3)]"
            >
              Wyślij
            </button>
          </form>
        </footer>
      </div>
    </div>
  );
}
