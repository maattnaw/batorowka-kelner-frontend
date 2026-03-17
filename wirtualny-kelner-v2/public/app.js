document.addEventListener('DOMContentLoaded', () => {
    const chatForm = document.getElementById('chat-form');
    const userInput = document.getElementById('user-input');
    const chatContainer = document.getElementById('chat-container');

    // Get table_id from URL query string
    const urlParams = new URLSearchParams(window.location.search);
    const tableId = urlParams.get('table_id') || 'unknown_table';

    const API_URL = 'https://europe-west3-project-2ccbfda4-273a-4a1a-ac8.cloudfunctions.net/handle_waiter_interaction'; // *** IMPORTANT: Replace with actual deployed SSE function URL ***

    // Firebase Initialization and Auth State Listener (Add this block)
    // You must ensure Firebase SDK is loaded in your HTML before this script.
    // Replace with your actual Firebase config if not already globally configured.
    if (typeof firebase === 'undefined' || !firebase.apps.length) {
        console.warn("Firebase is not initialized. Assuming it's initialized elsewhere or will be.");
        // Example: firebase.initializeApp({ apiKey: "...", authDomain: "...", ... });
    }

    let isFirebaseReady = false;
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            isFirebaseReady = true;
            console.log("Firebase user authenticated:", user.uid);
            // Once authenticated, initiate the chat session
            setTimeout(() => {
                sendToAPI("START", true);
            }, 500);
        } else {
            console.log("No Firebase user signed in. Attempting anonymous login.");
            firebase.auth().signInAnonymously().catch(error => {
                console.error("Error signing in anonymously:", error);
                addMessage("Błąd uwierzytelnienia. Odśwież stronę.", false);
            });
        }
    });

    function addMessage(text, isUser, options = []) {
        if (!text) return;
        const wrapper = document.createElement('div');
        wrapper.className = `flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-4`;

        const bubble = document.createElement('div');
        bubble.className = `rounded-lg p-3 max-w-[80%] shadow-md ${isUser ? 'message-user' : 'message-bot'}`;
        bubble.innerHTML = text.replace(/\n/g, '<br>');

        wrapper.appendChild(bubble);

        chatContainer.appendChild(wrapper);
        scrollToBottom();
    }

    function addTypingIndicator() {
        const wrapper = document.createElement('div');
        wrapper.className = `flex justify-start mb-4`;
        wrapper.id = 'typing-wrapper';

        const bubble = document.createElement('div');
        bubble.className = `rounded-lg max-w-[80%] p-3 shadow-md message-bot typing-indicator`;
        
        bubble.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        `;

        wrapper.appendChild(bubble);
        chatContainer.appendChild(wrapper);
        scrollToBottom();
    }

    function removeTypingIndicator() {
        const indicator = document.getElementById('typing-wrapper');
        if (indicator) {
            indicator.remove();
        }
    }

    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function renderButtons(options, parentElement, sendFunction) {
        if (!options || options.length === 0) return;

        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'flex flex-wrap gap-2 mt-2';

        options.forEach(opt => {
            const btn = document.createElement('button');

            btn.className = 'text-sm py-1 px-3 rounded-full transition-colors cursor-pointer select-none touch-manipulation focus:outline-none focus:ring-2 focus:ring-offset-2';

            const optLower = opt.toLowerCase();
            if (optLower.includes("for other languages")) {
                btn.classList.add('bg-green-500', 'hover:bg-green-600', 'text-white', 'font-bold', 'border', 'border-green-600', 'focus:ring-green-500');
            } else if (optLower.includes("karta naszych win")) {
                btn.classList.add('bg-blue-600', 'hover:bg-blue-700', 'text-white', 'font-bold', 'border', 'border-blue-700', 'focus:ring-blue-600');
            } else {
                btn.classList.add('bg-gray-200', 'hover:bg-gray-300', 'text-gray-800', 'focus:ring-gray-300');
            }

            btn.textContent = opt;
            btn.onclick = (e) => {
                e.preventDefault();
                btn.disabled = true;
                btn.classList.add('opacity-50');
                sendFunction(opt);
            };
            optionsContainer.appendChild(btn);
        });
        parentElement.appendChild(optionsContainer);
    }


    async function sendToAPI(message, isSystemAction = false) {
        if (!message) return;

        if (!isSystemAction) {
            addMessage(message, true);
        }
        
        userInput.value = '';
        userInput.disabled = true;

        addTypingIndicator();

        try {
            if (!isFirebaseReady || !firebase.auth().currentUser) {
                console.warn("Firebase not ready or user not authenticated, waiting...");
                await new Promise(resolve => {
                    const unsubscribe = firebase.auth().onAuthStateChanged(user => {
                        if (user) {
                            unsubscribe();
                            resolve();
                        }
                    });
                });
            }
            const idToken = await firebase.auth().currentUser.getIdToken();
            const clientId = firebase.auth().currentUser.uid; // Use Firebase UID as clientId

            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    message: message,
                    clientId: clientId,
                    table: tableId
                })
            });

            if (!response.ok) {
                removeTypingIndicator();
                const errorText = await response.text();
                throw new Error(`Błąd HTTP! status: ${response.status}, wiadomość: ${errorText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let finalBotReply = '';
            let finalButtons = [];

            // Create a temporary bubble to stream text into
            const botMessageWrapper = document.createElement('div');
            botMessageWrapper.className = `flex flex-col items-start mb-4`;
            const botMessageBubble = document.createElement('div');
            botMessageBubble.className = `rounded-lg p-3 max-w-[80%] shadow-md message-bot`;
            botMessageWrapper.appendChild(botMessageBubble);
            chatContainer.appendChild(botMessageWrapper);
            scrollToBottom();
            
            // Initial placeholder to show it's a bot message
            botMessageBubble.innerHTML = '<span class="typing-placeholder">...</span>';


            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });

                const events = buffer.split('\n\n');
                buffer = events.pop();

                for (const eventString of events) {
                    if (eventString.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(eventString.substring(6));
                            if (data.type === 'actions') {
                                finalButtons = data.ui_state?.options || [];
                            } else if (data.text) {
                                finalBotReply += data.text;
                                botMessageBubble.innerHTML = finalBotReply.replace(/\n/g, '<br>');
                                scrollToBottom();
                            }
                        } catch (e) {
                            console.error("Error parsing data event:", e, "Event string:", eventString);
                        }
                    } else if (eventString.startsWith('event: error')) {
                        try {
                            const data = JSON.parse(eventString.substring('event: error\ndata: '.length));
                            throw new Error(`API Error: ${data.message}`);
                        } catch (e) {
                            console.error("Error parsing error event:", e, "Event string:", eventString);
                        }
                    }
                }
            }

            removeTypingIndicator();
            renderButtons(finalButtons, botMessageWrapper, sendToAPI); // Pass sendToAPI to handle button clicks

        } catch (error) {
            console.error('Błąd połączenia z API:', error);
            removeTypingIndicator();
            addMessage(`Przepraszamy, wystąpił problem z połączeniem: ${error.message}. Spróbuj ponownie.`, false, ["Spróbuj ponownie", "Zadzwoń po kelnera"]);
        } finally {
            userInput.disabled = false;
            userInput.focus();
        }
    }

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const msg = userInput.value.trim();
        if (isFirebaseReady) { // Only send if Firebase is ready
            sendToAPI(msg);
        } else {
            addMessage("Czekam na uwierzytelnienie. Spróbuj ponownie za chwilę.", false);
        }
    });
