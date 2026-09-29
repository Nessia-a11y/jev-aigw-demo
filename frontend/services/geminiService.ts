import { Message, UserRole } from '../types';

export const initChat = (role: UserRole) => {
    // Initialization logic if needed
};

/**
 * Calls the Portkey Decisions API (Jev) to classify the user's intent.
 */
async function getJevDecision(text: string): Promise<string> {
    try {
        const response = await fetch('https://aigw.portkey.ai/v1/decisions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-portkey-api-key': '$PORTKEY_API_KEY',
                'x-portkey-provider': '@typesafe',
                'Authorization': `$TYPESAFE_API_KEY`
            },
            body: JSON.stringify({
                model: 'jev-latest',
                state: text,
                questions: {
                    category: {
                        type: 'choice',
                        instructions: 'Which category does this request fall into?',
                        criteria: {
                            coding: 'Writing or generating code',
                            writing: 'Writing blog posts or long text',
                            general: 'General, professional, or daily questions'
                        }
                    }
                }
            })
        });

        if (!response.ok) {
            console.warn('Jev API failed, falling back to keyword routing.');
            return 'unknown';
        }

        const data = await response.json();
        // Extract the choice value from the Jev response
        const choice = data?.answers?.category?.choice;
        return choice || 'unknown';
    } catch (e) {
        console.warn('Jev API error, falling back to keyword routing.', e);
        return 'unknown';
    }
}

export async function* sendMessageStream(text: string, role: UserRole, imageUrl?: string, history: Message[] = []) {
    let messageHistory: any[] = [];
    try {
        let taskValue = 'unknown';

        if (role === 'developer') {
            // 1. Call Jev for decision
            taskValue = await getJevDecision(text);

            // Fallback to keyword if Jev fails
            if (taskValue === 'unknown') {
                const lowerText = text.toLowerCase();
                if (lowerText.includes('code') || lowerText.includes('python')) {
                    taskValue = 'coding';
                } else if (lowerText.includes('write') || lowerText.includes('blog')) {
                    taskValue = 'writing';
                } else {
                    taskValue = 'general';
                }
            }
        }

        // Construct message history for OpenAI format
        messageHistory = history
            .filter(m => !m.isError && !m.isFallback && m.text && m.id !== 'init-msg')
            .map(m => {
                let content: any = m.text;
                if (m.imageUrl && m.role === 'user') {
                    content = [
                        { type: 'text', text: m.text },
                        { type: 'image_url', image_url: { url: m.imageUrl } }
                    ];
                }
                return {
                    role: m.role === 'model' ? 'assistant' : 'user',
                    content: content
                };
            });

        // If history is empty (e.g. not passed), just use the current text
        if (messageHistory.length === 0) {
            let content: any = text;
            if (imageUrl) {
                content = [
                    { type: 'text', text: text },
                    { type: 'image_url', image_url: { url: imageUrl } }
                ];
            }
            messageHistory.push({ role: 'user', content });
        }

        // 2. Call Portkey AIGW with the task value in metadata
        const response = await fetch('https://aigw.portkey.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-portkey-api-key': '$PORTKEY_API_KEY',
                'x-portkey-config': '$PORTKEY_CONFIG',
                'x-portkey-cache': 'simple',
                'x-portkey-metadata': JSON.stringify({ task: taskValue, role: role })
            },
            body: JSON.stringify({
                messages: messageHistory,
                stream: true
            })
        });

        if (!response.ok) {
            throw new Error(`Portkey API error: ${response.status}`);
        }

        // Yield a special chunk to show the routing decision in the UI for developers
        if (role === 'developer') {
            yield {
                type: 'content',
                text: `*(Smart Routed via Jev category: **${taskValue}**)*\n\n`,
                cacheHit: false,
                tokensSaved: 0,
                traceId: 'trace-' + Date.now()
            };
        }

        // 3. Parse SSE stream
        const reader = response.body?.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        let isCacheHit = false;
        let actualModel = 'unknown model';
        let traceId = 'trace-' + Date.now();
        let totalTokens = 0;
        let fullContent = '';
        let isFallbackYielded = false;

        // Try to get cache status from HTTP Header
        const cacheHeader = response.headers.get('x-portkey-cache-status') || response.headers.get('X-Portkey-Cache-Status');
        if (cacheHeader && cacheHeader.toUpperCase().includes('HIT')) {
            isCacheHit = true;
        }

        if (reader) {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                // Handle standard SSE stream
                if (buffer.includes('data: ')) {
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (trimmedLine.startsWith('data: ')) {
                            const dataStr = trimmedLine.substring(6);
                            if (dataStr === '[DONE]') continue;
                            try {
                                const data = JSON.parse(dataStr);
                                
                                // Compatible with nested JSON structure
                                const body = data.body || data;
                                
                                if (body.model) actualModel = body.model;
                                
                                // Get traceId from body.id
                                if (body.id) traceId = body.id;
                                
                                // If 'cached_tokens' exists in body.usage, it's a miss, otherwise it's a hit
                                if (body.usage) {
                                    if (body.usage.total_tokens) totalTokens = body.usage.total_tokens;
                                    
                                    const hasCachedTokens = 'cached_tokens' in body.usage || 
                                                            (body.usage.prompt_tokens_details && 'cached_tokens' in body.usage.prompt_tokens_details);
                                    isCacheHit = !hasCachedTokens;
                                }

                                const deltaContent = body.choices?.[0]?.delta?.content || body.choices?.[0]?.message?.content || '';
                                if (deltaContent) {
                                    if (role === 'developer' && taskValue === 'code' && !isFallbackYielded) {
                                        yield { type: 'fallback', text: 'Fallback: ⚠️ Primary model timeout detected. Portkey automatically switched to the fallback model.' };
                                        isFallbackYielded = true;
                                    }
                                    
                                    fullContent += deltaContent;
                                    yield { type: 'content', text: deltaContent, cacheHit: isCacheHit, tokensSaved: totalTokens, traceId };
                                }
                            } catch (e) {}
                        }
                    }
                }
            }

            // Handle non-SSE full JSON response (e.g., Portkey returns direct JSON object on cache hit)
            if (buffer.trim().startsWith('{') && !buffer.includes('data: ')) {
                try {
                    const data = JSON.parse(buffer.trim());
                    
                    const body = data.body || data;
                    if (body.model) actualModel = body.model;
                    
                    // Get traceId from body.id
                    if (body.id) traceId = body.id;
                    
                    if (body.usage) {
                        if (body.usage.total_tokens) totalTokens = body.usage.total_tokens;
                        
                        const hasCachedTokens = 'cached_tokens' in body.usage || 
                                                (body.usage.prompt_tokens_details && 'cached_tokens' in body.usage.prompt_tokens_details);
                        isCacheHit = !hasCachedTokens;
                    }
                    
                    const content = body.choices?.[0]?.message?.content || body.choices?.[0]?.delta?.content || '';
                    
                    if (content) {
                        if (role === 'developer' && taskValue === 'code' && !isFallbackYielded) {
                            yield { type: 'fallback', text: 'Fallback: ⚠️ Primary model timeout detected. Portkey automatically switched to the fallback model.' };
                            isFallbackYielded = true;
                        }
                        
                        // Simulate streaming output
                        const chunkSize = 4;
                        for (let i = 0; i < content.length; i += chunkSize) {
                            const chunk = content.substring(i, i + chunkSize);
                            fullContent += chunk;
                            yield { type: 'content', text: chunk, cacheHit: isCacheHit, tokensSaved: totalTokens, traceId };
                            await new Promise(resolve => setTimeout(resolve, 10));
                        }
                    }
                } catch (e) {
                    console.error("Failed to parse buffered JSON", e);
                }
            }

            // After stream ends, append model and cache info to the end of the reply
            if (fullContent) {
                let footer = `\n\n---\n🤖 *(Generated by ${actualModel})*`;
                if (isCacheHit) {
                    footer += `\n⚡ **Cache Hit** - Saved ${totalTokens} tokens`;
                }
                
                yield { type: 'content', text: footer, cacheHit: isCacheHit, tokensSaved: totalTokens, traceId };
                messageHistory.push({ role: 'assistant', content: fullContent });
            }
        }
    } catch (error) {
        console.error("Error sending message via Portkey:", error);
        messageHistory.pop();
        throw error;
    }
}

export const sendFeedback = (traceId: string, value: number) => {
    console.log(`Feedback sent for ${traceId}: ${value}`);
};
