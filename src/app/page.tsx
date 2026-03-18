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
    const newSessionId = 'table-' + Math.random().toString(36).substring(2, 9);
    setSessionId(newSessionId);
    
    setMessages([
      { role: 'assistant', content: 'Benvenuti! Jestem Wirtualnym Kelnerem Fresca Napoli. Czego byś się dzisiaj napił lub co zjadł?' }
    ]);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // --- KLUCZOWA POPRAWKA DLA BACKENDU ---
    // Twoja funkcja oczekuje kluczy: "table_id" i "message"
    const requestBody = {
      table_id: sessionId,
      message: input,
      payload: {}
    };

    try {
      const API_URL = 'https://handle-waiter-interaction-xqhpwhjfha-ey.a.run.app'; 

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.body) {
        throw new Error('Brak odpowiedzi z serwera');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantResponse = '';
      let buffer = '';
      
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim().startsWith('data: ')) {
            try {
              const jsonStr = line.replace('data: ', '').trim();
              if (!jsonStr) continue;
              
              const dataObj = JSON.parse(jsonStr);
              if (dataObj.type === 'chunk' && dataObj.text) {
                assistantResponse += dataObj.text;
                setMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1].content = assistantResponse;
                  return newMessages;
                });
              }
            } catch (e) {
              console.error("SSE parse error", e, line);
            }
          }
        }
      }
    } catch (error) {
      console.error('Błąd połączenia:', error);
      setMessages((prev) => {
        const newMessages = [...prev];
        if (newMessages[newMessages.length - 1].content === '') {
           newMessages[newMessages.length - 1].content = 'Przepraszam, problem z serwerem.';
        }
        return newMessages;
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div 
      className="flex flex-col h-screen text-white font-sans relative"
      style={{
        backgroundImage: "url('/fresca-bg.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#000"
      }}
    >
      {/* Bardzo mocne przyciemnienie tła (aż 90%), by wszystko było absolutnie czytelne */}
      <div 
        className="absolute inset-0 z-0" 
        style={{ backgroundColor: "rgba(0, 0, 0, 0.88)" }}
      ></div>

      {/* Główna zawartość */}
      <div className="relative z-10 flex flex-col h-full max-w-3xl w-full mx-auto shadow-2xl bg-black/40 border-x border-white/5">
        
        {/* Nagłówek */}
        <header className="pt-8 pb-6 px-4 text-center border-b border-[#D4AF37]/30" style={{ backgroundColor: 'rgba(5, 5, 5, 0.85)' }}>
          <h1 
            className="text-3xl md:text-4xl font-light tracking-widest text-white uppercase mb-1" 
            style={{ fontFamily: 'Georgia, serif', textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}
          >
            Wirtualny Kelner
          </h1>
          <h2 
            className="text-xl md:text-2xl font-bold uppercase mb-4" 
            style={{ color: '#D4AF37', fontFamily: 'Georgia, serif', letterSpacing: '0.25em' }}
          >
            Fresca Napoli
          </h2>
          <div className="inline-block mt-2">
            <p className="text-[13px] md:text-sm text-gray-300 italic font-light tracking-wide px-4 py-2 border border-gray-600/50 rounded-full bg-black/40 shadow-inner">
              "Jeśli czegoś nie lubisz lub masz alergie, napisz w czacie"
            </p>
          </div>
        </header>

        {/* Sekcja Czatu */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6" style={{ scrollBehavior: 'smooth' }}>
          {messages.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] md:max-w-[75%] px-5 py-4 shadow-xl border ${
                  msg.role === 'user'
                    ? 'rounded-2xl rounded-tr-sm font-medium'
                    : 'rounded-2xl rounded-tl-sm'
                }`}
                style={{
                  backgroundColor: msg.role === 'user' ? '#D4AF37' : 'rgba(24, 24, 27, 0.95)',
                  color: msg.role === 'user' ? '#000000' : '#FFFFFF',
                  borderColor: msg.role === 'user' ? '#C5A017' : 'rgba(212, 175, 55, 0.3)',
                  boxShadow: msg.role === 'user' ? '0 4px 15px rgba(212, 175, 55, 0.2)' : '0 4px 15px rgba(0, 0, 0, 0.5)'
                }}
              >
                <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{msg.content}</p>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </main>

        {/* Input Form */}
        <footer className="p-4 md:p-6 border-t border-white/10" style={{ backgroundColor: 'rgba(5, 5, 5, 0.9)' }}>
          <form onSubmit={handleSubmit} className="flex items-center space-x-3 bg-black/80 p-2 rounded-full border border-gray-700 shadow-inner">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isLoading ? 'Kelner analizuje...' : 'Napisz swoją wiadomość...'}
              disabled={isLoading}
              className="flex-1 px-5 py-3 bg-transparent text-white placeholder-gray-500 focus:outline-none"
              style={{ fontSize: '16px' }}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-6 md:px-8 py-3 font-bold rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider text-sm whitespace-nowrap"
              style={{
                backgroundColor: '#D4AF37',
                color: '#000',
                boxShadow: '0 0 10px rgba(212, 175, 55, 0.4)'
              }}
            >
              Wyślij
            </button>
          </form>
        </footer>
      </div>
    </div>
  );
}
