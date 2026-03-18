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
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const dataObj = JSON.parse(trimmed.substring(6).trim());
              
              // Poprawka: sprawdzanie czy text istnieje, nawet jak jest pusty (zastępuje !dataObj.text)
              if (dataObj.text !== undefined) {
                assistantResponse += dataObj.text;
                setMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1].content = assistantResponse;
                  return newMessages;
                });
              }
              // Poprawka: szukamy bezpośrednio 'options', nie w 'ui_state'
              if (dataObj.options) {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1].options = dataObj.options;
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
    <div 
      className="flex flex-col h-screen text-white font-sans relative"
      style={{
        backgroundImage: "url('/fresca-bg.jpg')",
        backgroundSize: "contain",
        backgroundPosition: "center top",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#000"
      }}
    >
      <div className="absolute inset-0 z-0" style={{ backgroundColor: "rgba(0, 0, 0, 0.85)" }}></div>

      <div className="relative z-10 flex flex-col h-full max-w-3xl w-full mx-auto shadow-2xl bg-black/50 border-x border-white/5">
        <header className="pt-6 pb-4 px-4 text-center border-b border-[#D4AF37]/30 backdrop-blur-sm" style={{ backgroundColor: 'rgba(5, 5, 5, 0.6)' }}>
          <h1 className="text-3xl md:text-4xl font-light tracking-widest text-white uppercase mb-1" style={{ fontFamily: 'Georgia, serif', textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
            Wirtualny Kelner
          </h1>
          <h2 className="text-xl md:text-2xl font-bold uppercase mb-3" style={{ color: '#D4AF37', fontFamily: 'Georgia, serif', letterSpacing: '0.25em' }}>
            Fresca Napoli
          </h2>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6" style={{ scrollBehavior: 'smooth' }}>
          {messages.map((msg, index) => (
            <div key={index} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[90%] md:max-w-[80%] px-5 py-4 shadow-xl border rounded-2xl ${msg.role === 'user' ? 'rounded-tr-sm font-medium' : 'rounded-tl-sm'}`}
                style={{
                  backgroundColor: msg.role === 'user' ? '#D4AF37' : 'rgba(24, 24, 27, 0.95)',
                  color: msg.role === 'user' ? '#000000' : '#FFFFFF',
                  borderColor: msg.role === 'user' ? '#C5A017' : 'rgba(212, 175, 55, 0.3)',
                }}
              >
                <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{msg.content || (isLoading && index === messages.length - 1 ? 'Kelner myśli...' : '')}</p>
              </div>
              {msg.role === 'assistant' && msg.options && msg.options.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 max-w-[90%] md:max-w-[80%]">
                  {msg.options.map((opt, optIdx) => (
                    <button
                      key={optIdx}
                      onClick={() => sendMessageToBackend(opt)}
                      disabled={isLoading}
                      className="px-4 py-2 text-sm font-semibold rounded-full transition-all border border-[#D4AF37] text-[#D4AF37] bg-black/70 hover:bg-[#D4AF37] hover:text-black"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </main>

        <footer className="p-4 md:p-6 border-t border-white/10" style={{ backgroundColor: 'rgba(5, 5, 5, 0.95)' }}>
          <form onSubmit={(e) => { e.preventDefault(); sendMessageToBackend(input); }} className="flex items-center space-x-3 bg-black p-2 rounded-full border border-gray-700 shadow-inner">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isLoading ? 'Kelner analizuje...' : 'Napisz swoją wiadomość...'}
              disabled={isLoading}
              className="flex-1 px-5 py-3 bg-transparent text-white placeholder-gray-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-6 md:px-8 py-3 font-bold rounded-full transition-all bg-[#D4AF37] text-black uppercase tracking-wider text-sm whitespace-nowrap"
            >
              Wyślij
            </button>
          </form>
        </footer>
      </div>
    </div>
  );
}
