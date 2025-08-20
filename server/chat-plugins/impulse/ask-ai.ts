/**
 * AI Chat Plugin for Pokemon Showdown
 * Command: /askai <question>
 * Integrates with Google Gemini AI
 */

import * as https from 'https';

// Import Config for accessing server configuration
declare const Config: {
    geminiKey?: string;
    [key: string]: any;
};

// Type definitions for Pokemon Showdown
interface User {
    userid: string;
    name: string;
    can(permission: string): boolean;
}

interface Room {
    roomid: string;
    title: string;
    users: Map<string, User>;
}

interface CommandContext {
    user: User;
    room?: Room;
    connection: any;
    target: string;
    message: string;
    parse(command: string): void;
    sendReply(message: string): void;
    sendReplyBox(html: string): void;
    errorReply(message: string): void;
    modlog(message: string): void;
}

// Gemini API types
interface GeminiPart {
    text: string;
}

interface GeminiContent {
    parts: GeminiPart[];
}

interface GeminiRequest {
    contents: GeminiContent[];
    generationConfig?: {
        maxOutputTokens?: number;
        temperature?: number;
        topP?: number;
        topK?: number;
    };
}

interface GeminiCandidate {
    content: {
        parts: GeminiPart[];
    };
}

interface GeminiResponse {
    candidates?: GeminiCandidate[];
    error?: {
        message: string;
        code?: number;
    };
}

// Configuration interface
interface AIConfig {
    GEMINI_API_KEY: string;
    GEMINI_MODEL: string;
    GEMINI_ENDPOINT: string;
    COOLDOWN_TIME: number;
    MAX_QUESTION_LENGTH: number;
    MAX_RESPONSE_LENGTH: number;
    ENABLE_CONTENT_FILTER: boolean;
    FILTER_ACTION: 'block' | 'warn' | 'log';
    STRIKE_SYSTEM_ENABLED: boolean;
    MAX_STRIKES: number;
}

// Content filter interfaces
interface FilterCategory {
    name: string;
    keywords: string[];
    severity: 'low' | 'medium' | 'high';
    enabled: boolean;
}

interface FilterResult {
    blocked: boolean;
    category?: string;
    matchedKeyword?: string;
    severity?: 'low' | 'medium' | 'high';
    reason?: string;
}

interface UserStrike {
    count: number;
    lastStrike: number;
    violations: string[];
}

// Context conversation interfaces
interface ConversationMessage {
    role: 'user' | 'ai';
    content: string;
    timestamp: number;
    username?: string;
}

interface RoomContext {
    roomid: string;
    messages: ConversationMessage[];
    lastActivity: number;
    maxMessages: number;
}

// Context configuration
interface ContextConfig {
    ENABLE_CONTEXT: boolean;
    MAX_CONTEXT_MESSAGES: number;
    CONTEXT_TIMEOUT: number; // milliseconds
    MAX_CONTEXT_LENGTH: number; // characters
}

// Configuration
const AI_CONFIG: AIConfig = {
    GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY_HERE', // Replace with your actual API key
    GEMINI_MODEL: 'gemini-pro',
    GEMINI_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
    COOLDOWN_TIME: 20 * 1000, // 20 seconds in milliseconds
    MAX_QUESTION_LENGTH: 500,
    MAX_RESPONSE_LENGTH: 1000,
    ENABLE_CONTENT_FILTER: true,
    FILTER_ACTION: 'block', // 'block', 'warn', or 'log'
    STRIKE_SYSTEM_ENABLED: true,
    MAX_STRIKES: 3
};

// Store cooldowns, strikes, and room contexts
const userCooldowns = new Map<string, number>();
const userStrikes = new Map<string, UserStrike>();
const roomContexts = new Map<string, RoomContext>();

// Content filtering blacklists organized by category
const FILTER_CATEGORIES: FilterCategory[] = [
    {
        name: 'explicit_content',
        severity: 'high',
        enabled: true,
        keywords: [
            'porn', 'sex', 'nude', 'naked', 'xxx', 'nsfw', 'adult', 'erotic',
            'sexual', 'intercourse', 'masturbat', 'orgasm', 'horny', 'aroused',
            'fetish', 'kinky', 'escort', 'prostitut', 'hookup', 'onlyfans'
        ]
    },
    {
        name: 'violence_harm',
        severity: 'high',
        enabled: true,
        keywords: [
            'kill', 'murder', 'suicide', 'death', 'harm', 'hurt', 'violence',
            'weapon', 'gun', 'knife', 'bomb', 'explosive', 'terrorist',
            'assassinate', 'torture', 'abuse', 'beat up', 'fight', 'attack'
        ]
    },
    {
        name: 'illegal_activities',
        severity: 'high',
        enabled: true,
        keywords: [
            'drug', 'cocaine', 'heroin', 'meth', 'weed', 'marijuana', 'cannabis',
            'steal', 'theft', 'robbery', 'fraud', 'scam', 'hack', 'piracy',
            'illegal', 'crime', 'criminal', 'smuggle', 'trafficking'
        ]
    },
    {
        name: 'hate_speech',
        severity: 'high',
        enabled: true,
        keywords: [
            'racist', 'racism', 'nazi', 'fascist', 'genocide', 'ethnic cleansing',
            'supremacist', 'hate crime', 'discrimination', 'bigot', 'xenophob',
            'homophob', 'transphob', 'islamophob', 'antisemit'
        ]
    },
    {
        name: 'personal_info',
        severity: 'medium',
        enabled: true,
        keywords: [
            'address', 'phone number', 'social security', 'credit card',
            'password', 'login', 'account', 'personal info', 'doxx', 'dox',
            'real name', 'location', 'ip address', 'email', 'private'
        ]
    },
    {
        name: 'spam_abuse',
        severity: 'low',
        enabled: true,
        keywords: [
            'spam', 'flood', 'repeat', 'copy paste', 'bot', 'automated',
            'mass message', 'bulk', 'advertisement', 'promotion', 'clickbait'
        ]
    },
    {
        name: 'showdown_violations',
        severity: 'medium',
        enabled: true,
        keywords: [
            'cheat', 'hack showdown', 'exploit', 'bug abuse', 'alt account',
            'evade ban', 'grief', 'troll', 'raid', 'brigad', 'coordinated attack'
        ]
    },
    {
        name: 'inappropriate_requests',
        severity: 'medium',
        enabled: true,
        keywords: [
            'bypass filter', 'break rules', 'ignore moderation', 'jailbreak',
            'pretend you are', 'roleplay as', 'act like', 'ignore instructions'
        ]
    }
];

/**
 * Check content against blacklists
 */
function checkContentFilter(question: string): FilterResult {
    if (!AI_CONFIG.ENABLE_CONTENT_FILTER) {
        return { blocked: false };
    }

    const lowercaseQuestion = question.toLowerCase();
    
    // Check against each category
    for (const category of FILTER_CATEGORIES) {
        if (!category.enabled) continue;
        
        for (const keyword of category.keywords) {
            if (lowercaseQuestion.includes(keyword.toLowerCase())) {
                return {
                    blocked: true,
                    category: category.name,
                    matchedKeyword: keyword,
                    severity: category.severity,
                    reason: `Content blocked: ${category.name.replace('_', ' ')} violation`
                };
            }
        }
    }
    
    return { blocked: false };
}

/**
 * Add strike to user
 */
function addStrike(userid: string, violation: string): void {
    if (!AI_CONFIG.STRIKE_SYSTEM_ENABLED) return;
    
    const currentStrikes = userStrikes.get(userid) || {
        count: 0,
        lastStrike: 0,
        violations: []
    };
    
    currentStrikes.count++;
    currentStrikes.lastStrike = Date.now();
    currentStrikes.violations.push(violation);
    
    // Keep only last 10 violations for memory management
    if (currentStrikes.violations.length > 10) {
        currentStrikes.violations = currentStrikes.violations.slice(-10);
    }
    
    userStrikes.set(userid, currentStrikes);
}

/**
 * Get user strikes
 */
function getUserStrikes(userid: string): UserStrike {
    return userStrikes.get(userid) || { count: 0, lastStrike: 0, violations: [] };
}

/**
 * Check if user has exceeded strike limit
 */
function isUserBanned(userid: string): boolean {
    if (!AI_CONFIG.STRIKE_SYSTEM_ENABLED) return false;
    
    const strikes = getUserStrikes(userid);
    return strikes.count >= AI_CONFIG.MAX_STRIKES;
}

/**
 * Get or create room context
 */
function getRoomContext(roomid: string): RoomContext {
    let context = roomContexts.get(roomid);
    
    if (!context) {
        context = {
            roomid,
            messages: [],
            lastActivity: Date.now(),
            maxMessages: AI_CONFIG.CONTEXT.MAX_CONTEXT_MESSAGES
        };
        roomContexts.set(roomid, context);
    }
    
    return context;
}

/**
 * Add message to room context
 */
function addToContext(roomid: string, role: 'user' | 'ai', content: string, username?: string): void {
    if (!AI_CONFIG.CONTEXT.ENABLE_CONTEXT) return;
    
    const context = getRoomContext(roomid);
    
    // Clean expired context
    cleanExpiredContext(roomid);
    
    const message: ConversationMessage = {
        role,
        content: content.substring(0, AI_CONFIG.CONTEXT.MAX_CONTEXT_LENGTH),
        timestamp: Date.now(),
        username
    };
    
    context.messages.push(message);
    context.lastActivity = Date.now();
    
    // Keep only recent messages
    if (context.messages.length > context.maxMessages) {
        context.messages = context.messages.slice(-context.maxMessages);
    }
}

/**
 * Get context for AI request
 */
function getContextForAI(roomid: string): ConversationMessage[] {
    if (!AI_CONFIG.CONTEXT.ENABLE_CONTEXT) return [];
    
    const context = getRoomContext(roomid);
    cleanExpiredContext(roomid);
    
    return context.messages.slice(); // Return copy
}

/**
 * Clean expired context from room
 */
function cleanExpiredContext(roomid: string): void {
    const context = roomContexts.get(roomid);
    if (!context) return;
    
    const cutoffTime = Date.now() - AI_CONFIG.CONTEXT.CONTEXT_TIMEOUT;
    context.messages = context.messages.filter(msg => msg.timestamp > cutoffTime);
    
    if (context.messages.length === 0) {
        roomContexts.delete(roomid);
    }
}

/**
 * Clear all context for a room
 */
function clearRoomContext(roomid: string): void {
    roomContexts.delete(roomid);
}

/**
 * Get context summary for display
 */
function getContextSummary(roomid: string): string {
    const context = roomContexts.get(roomid);
    if (!context || context.messages.length === 0) {
        return "No conversation context available.";
    }
    
    cleanExpiredContext(roomid);
    const currentContext = roomContexts.get(roomid);
    if (!currentContext || currentContext.messages.length === 0) {
        return "No active conversation context (expired).";
    }
    
    const messageCount = currentContext.messages.length;
    const lastActivity = new Date(currentContext.lastActivity).toLocaleString();
    const userMessages = currentContext.messages.filter(m => m.role === 'user').length;
    const aiMessages = currentContext.messages.filter(m => m.role === 'ai').length;
    
    return `Context: ${messageCount} messages (${userMessages} user, ${aiMessages} AI), last activity: ${lastActivity}`;
}

/**
 * Make API request to Gemini with optional context
 */
function callGeminiAPI(question: string, context?: ConversationMessage[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const contents: GeminiContent[] = [];
        
        // Add context messages if provided
        if (context && context.length > 0) {
            for (const message of context) {
                contents.push({
                    parts: [{
                        text: message.role === 'user' ? 
                            `User (${message.username || 'Unknown'}): ${message.content}` : 
                            `Assistant: ${message.content}`
                    }]
                });
            }
        }
        
        // Add current question
        contents.push({
            parts: [{
                text: question
            }]
        });

        const requestData: GeminiRequest = {
            contents,
            generationConfig: {
                maxOutputTokens: 500,
                temperature: 0.7,
                topP: 0.8,
                topK: 40
            }
        };

        const requestBody = JSON.stringify(requestData);

        const options: https.RequestOptions = {
            hostname: 'generativelanguage.googleapis.com',
            port: 443,
            path: `/v1beta/models/${AI_CONFIG.GEMINI_MODEL}:generateContent?key=${Config.geminiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk: Buffer) => {
                data += chunk.toString();
            });
            
            res.on('end', () => {
                try {
                    const response: GeminiResponse = JSON.parse(data);
                    
                    if (response.candidates && response.candidates[0] && response.candidates[0].content) {
                        const aiResponse = response.candidates[0].content.parts[0].text;
                        resolve(aiResponse);
                    } else if (response.error) {
                        reject(new Error(`Gemini API Error: ${response.error.message}`));
                    } else {
                        reject(new Error('Invalid response from Gemini API'));
                    }
                } catch (error: any) {
                    reject(new Error(`Failed to parse API response: ${error.message}`));
                }
            });
        });

        req.on('error', (error: Error) => {
            reject(new Error(`API Request failed: ${error.message}`));
        });

        req.write(requestBody);
        req.end();
    });
}

/**
 * Check if user is on cooldown
 */
function isOnCooldown(userid: string): boolean {
    const lastUsed = userCooldowns.get(userid);
    if (!lastUsed) return false;
    
    const timeRemaining = AI_CONFIG.COOLDOWN_TIME - (Date.now() - lastUsed);
    return timeRemaining > 0;
}

/**
 * Get remaining cooldown time in seconds
 */
function getCooldownTime(userid: string): number {
    const lastUsed = userCooldowns.get(userid);
    if (!lastUsed) return 0;
    
    const timeRemaining = AI_CONFIG.COOLDOWN_TIME - (Date.now() - lastUsed);
    return Math.ceil(timeRemaining / 1000);
}

/**
 * Set user cooldown
 */
function setCooldown(userid: string): void {
    userCooldowns.set(userid, Date.now());
}

/**
 * Escape HTML for safe display
 */
function escapeHTML(str: string): string {
    return str.replace(/[&<>"']/g, (match) => {
        const escapeChars: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return escapeChars[match];
    });
}

/**
 * Format filter warning message
 */
function formatFilterMessage(filterResult: FilterResult, username: string): string {
    const severity = filterResult.severity || 'medium';
    const severityEmoji = severity === 'high' ? '🔴' : severity === 'medium' ? '🟡' : '🟢';
    
    let result = '<div style="padding: 10px; border: 2px solid #e53e3e; border-radius: 5px; background-color: #fed7d7; color: #742a2a;">';
    result += severityEmoji + ' <strong>Content Filter Alert</strong><br>';
    result += '<strong>User:</strong> ' + escapeHTML(username) + '<br>';
    result += '<strong>Reason:</strong> ' + escapeHTML(filterResult.reason || 'Inappropriate content detected') + '<br>';
    result += '<strong>Severity:</strong> ' + severity.toUpperCase() + '<br>';
    result += '<div style="margin-top: 5px; font-size: 12px; opacity: 0.8;">';
    result += 'This message has been blocked to maintain a safe environment.';
    result += '</div>';
    result += '</div>';
    
    return result;
}

/**
 * Format AI response with context indicator
 */
function formatContextAIResponse(question: string, response: string, username: string, hasContext: boolean): string {
    const truncatedResponse = response.length > AI_CONFIG.MAX_RESPONSE_LENGTH ? 
        response.substring(0, AI_CONFIG.MAX_RESPONSE_LENGTH) + '...' : response;
    
    const contextIndicator = hasContext ? 
        '<span style="background: #e6f3ff; padding: 2px 6px; border-radius: 3px; font-size: 11px;">📝 With Context</span>' : 
        '<span style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 11px;">🆕 New Conversation</span>';
    
    let result = '<div style="max-height: 250px; overflow-y: auto; padding: 10px; border: 1px solid #ccc; border-radius: 5px; background-color: #f9f9f9;">';
    result += '<h3 style="margin: 0 0 10px 0; color: #2c5282; font-size: 14px;">';
    result += '🤖 AI Response to ' + escapeHTML(username) + '\'s question ' + contextIndicator;
    result += '</h3>';
    result += '<div style="margin-bottom: 8px; font-weight: bold; color: #2d3748;">';
    result += '<strong>Question:</strong> ' + escapeHTML(question);
    result += '</div>';
    result += '<div style="color: #4a5568; line-height: 1.4;">';
    result += '<strong>Answer:</strong> ' + escapeHTML(truncatedResponse);
    result += '</div>';
    result += '<div style="margin-top: 8px; font-size: 12px; color: #718096; text-align: right;">';
    result += 'Powered by Google Gemini AI';
    result += '</div>';
    result += '</div>';
    
    return result;
}

// Command handler type
type CommandHandler = (this: CommandContext, target: string, room: Room | undefined, user: User) => Promise<void> | void;

// Command definition interface
interface Command {
    permission?: string[];
    disableInPM?: boolean;
    action: CommandHandler;
    help?: string[];
}

// Commands export
export const commands: Record<string, Command> = {
    askai: {
        permission: ['voice', 'driver', 'moderator', 'bot', 'roomowner', 'administrator'],
        disableInPM: true,
        async action(this: CommandContext, target: string, room: Room | undefined, user: User): Promise<void> {
            // Check permissions (global voice and above)
            if (!user.can('lock')) {
                return this.errorReply("Access denied. This command requires global voice or higher permissions.");
            }

            // Check if user is banned due to strikes
            if (isUserBanned(user.userid)) {
                const strikes = getUserStrikes(user.userid);
                return this.errorReply('You have been temporarily banned from using AI commands due to ' + strikes.count + ' content violations. Contact a moderator if you believe this is an error.');
            }

            // Check if user is on cooldown
            if (isOnCooldown(user.userid)) {
                const remainingTime = getCooldownTime(user.userid);
                return this.errorReply('You must wait ' + remainingTime + ' more seconds before using this command again.');
            }

            // Validate input
            if (!target || !target.trim()) {
                return this.errorReply("Usage: /askai <question> - Ask the AI a question");
            }

            const question: string = target.trim();
            
            // Content filtering check
            const filterResult = checkContentFilter(question);
            if (filterResult.blocked) {
                // Add strike to user
                addStrike(user.userid, filterResult.reason || 'Inappropriate content');
                
                // Log the violation
                this.modlog(`AI Filter: ${user.name} - ${filterResult.reason} - Keyword: "${filterResult.matchedKeyword}"`);
                
                // Handle based on filter action setting
                switch (AI_CONFIG.FILTER_ACTION) {
                    case 'block':
                        return this.errorReply('Your question was blocked due to inappropriate content. Strike ' + getUserStrikes(user.userid).count + '/' + AI_CONFIG.MAX_STRIKES);
                    
                    case 'warn':
                        this.sendReplyBox(formatFilterMessage(filterResult, user.name));
                        return this.errorReply(`Warning: Your question contains potentially inappropriate content and will not be processed.`);
                    
                    case 'log':
                        // Continue processing but log the violation
                        console.log('Content Filter Log: User ' + user.name + ' - ' + filterResult.reason);
                        break;
                }
            }
            
            if (question.length > AI_CONFIG.MAX_QUESTION_LENGTH) {
                return this.errorReply('Question too long. Maximum ' + AI_CONFIG.MAX_QUESTION_LENGTH + ' characters allowed.');
            }

            // Check API key configuration
            if (!Config.geminiKey) {
                return this.errorReply("AI service is not configured. Please contact an administrator.");
            }

            // Set cooldown immediately to prevent spam
            setCooldown(user.userid);

            try {
                // Show loading message
                this.sendReply("🤖 Asking AI, please wait...");

                // Call Gemini API
                const aiResponse: string = await callGeminiAPI(question);
                
                // Format and send response
                const formattedResponse: string = formatContextAIResponse(question, aiResponse, user.name, false);
                
                // Broadcast to room using sendReplyBox
                this.sendReplyBox(formattedResponse);
                
                // Log the usage
                this.modlog(user.name + ' used /askai: ' + question.substring(0, 50) + (question.length > 50 ? '...' : ''));
                
            } catch (error: any) {
                // Remove cooldown on error to allow retry
                userCooldowns.delete(user.userid);
                
                console.error('AI Plugin Error for user ' + user.name + ':', error);
                
                let errorMessage = "An error occurred while processing your request.";
                if (error.message.includes('API key')) {
                    errorMessage = "Invalid API configuration. Please contact an administrator.";
                } else if (error.message.includes('quota') || error.message.includes('limit')) {
                    errorMessage = "AI service quota exceeded. Please try again later.";
                }
                
                return this.errorReply(errorMessage);
            }
        },
        help: ["/askai <question> - Ask the AI a question using Google Gemini. Requires global voice or higher. Has a 20-second cooldown."]
    },

    askaicontext: {
        permission: ['voice', 'driver', 'moderator', 'bot', 'roomowner', 'administrator'],
        disableInPM: true,
        async action(this: CommandContext, target: string, room: Room | undefined, user: User): Promise<void> {
            // Check permissions (global voice and above)
            if (!user.can('lock')) {
                return this.errorReply("Access denied. This command requires global voice or higher permissions.");
            }

            // Check if context is enabled
            if (!AI_CONFIG.CONTEXT.ENABLE_CONTEXT) {
                return this.errorReply("Context conversations are currently disabled.");
            }

            // Check if user is banned due to strikes
            if (isUserBanned(user.userid)) {
                const strikes = getUserStrikes(user.userid);
                return this.errorReply(`You have been temporarily banned from using AI commands due to ${strikes.count} content violations. Contact a moderator if you believe this is an error.`);
            }

            // Check if user is on cooldown
            if (isOnCooldown(user.userid)) {
                const remainingTime = getCooldownTime(user.userid);
                return this.errorReply(`You must wait ${remainingTime} more seconds before using this command again.`);
            }

            // Validate input
            if (!target || !target.trim()) {
                return this.errorReply("Usage: /askaicontext <question> - Ask the AI a question with conversation context");
            }

            const question: string = target.trim();
            
            // Content filtering check
            const filterResult = checkContentFilter(question);
            if (filterResult.blocked) {
                // Add strike to user
                addStrike(user.userid, filterResult.reason || 'Inappropriate content');
                
                // Log the violation
                this.modlog(`AI Filter (Context): ${user.name} - ${filterResult.reason} - Keyword: "${filterResult.matchedKeyword}"`);
                
                // Handle based on filter action setting
                switch (AI_CONFIG.FILTER_ACTION) {
                    case 'block':
                        return this.errorReply(`Your question was blocked due to inappropriate content. Strike ${getUserStrikes(user.userid).count}/${AI_CONFIG.MAX_STRIKES}`);
                    
                    case 'warn':
                        this.sendReplyBox(formatFilterMessage(filterResult, user.name));
                        return this.errorReply(`Warning: Your question contains potentially inappropriate content and will not be processed.`);
                    
                    case 'log':
                        // Continue processing but log the violation
                        console.log(`Content Filter Log (Context): User ${user.name} - ${filterResult.reason}`);
                        break;
                }
            }
            
            if (question.length > AI_CONFIG.MAX_QUESTION_LENGTH) {
                return this.errorReply(`Question too long. Maximum ${AI_CONFIG.MAX_QUESTION_LENGTH} characters allowed.`);
            }

            // Check API key configuration
            if (!Config.geminiKey) {
                return this.errorReply("AI service is not configured. Please contact an administrator.");
            }

            // Get room context
            if (!room) {
                return this.errorReply("Context conversations are only available in rooms.");
            }

            const roomid = room.roomid;
            const context = getContextForAI(roomid);
            const hasContext = context.length > 0;

            // Set cooldown immediately to prevent spam
            setCooldown(user.userid);

            try {
                // Show loading message with context info
                this.sendReply('🤖 Asking AI with ' + (hasContext ? context.length + ' context messages' : 'no previous context') + ', please wait...');

                // Call Gemini API with context
                const aiResponse: string = await callGeminiAPI(question, context);
                
                // Add user question to context
                addToContext(roomid, 'user', question, user.name);
                
                // Add AI response to context
                addToContext(roomid, 'ai', aiResponse);
                
                // Format and send response
                const formattedResponse: string = formatContextAIResponse(question, aiResponse, user.name, hasContext);
                
                // Broadcast to room using sendReplyBox
                this.sendReplyBox(formattedResponse);
                
                // Log the usage
                this.modlog(user.name + ' used /askaicontext (' + (hasContext ? context.length + ' context msgs' : 'no context') + '): ' + question.substring(0, 50) + (question.length > 50 ? '...' : ''));
                
            } catch (error: any) {
                // Remove cooldown on error to allow retry
                userCooldowns.delete(user.userid);
                
                console.error('AI Context Plugin Error for user ' + user.name + ':', error);
                
                let errorMessage = "An error occurred while processing your request.";
                if (error.message.includes('API key')) {
                    errorMessage = "Invalid API configuration. Please contact an administrator.";
                } else if (error.message.includes('quota') || error.message.includes('limit')) {
                    errorMessage = "AI service quota exceeded. Please try again later.";
                }
                
                return this.errorReply(errorMessage);
            }
        },
        help: ["/askaicontext <question> - Ask the AI a question with conversation context. Remembers previous messages in the room."]
    },

    askaicontext_clear: {
        permission: ['driver', 'moderator', 'roomowner', 'administrator'],
        disableInPM: true,
        action(this: CommandContext, target: string, room: Room | undefined): void {
            if (!room) {
                return this.errorReply("This command can only be used in rooms.");
            }

            const roomid = room.roomid;
            clearRoomContext(roomid);
            
            this.sendReply(`🗑️ Cleared conversation context for this room.`);
            this.modlog(this.user.name + ' cleared AI context for ' + roomid);
        },
        help: ["/askaicontext_clear - Clear conversation context for current room. Requires driver or higher."]
    },

    askaicontext_status: {
        permission: ['voice', 'driver', 'moderator', 'bot', 'roomowner', 'administrator'],
        disableInPM: true,
        action(this: CommandContext, target: string, room: Room | undefined): void {
            if (!room) {
                return this.errorReply("This command can only be used in rooms.");
            }

            if (!AI_CONFIG.CONTEXT.ENABLE_CONTEXT) {
                return this.sendReply("❌ Context conversations are currently disabled.");
            }

            const roomid = room.roomid;
            const summary = getContextSummary(roomid);
            
            this.sendReply('📝 Context Status: ' + summary);
        },
        help: ["/askaicontext_status - Check conversation context status for current room."]
    },
        permission: ['driver', 'moderator', 'roomowner', 'administrator'],
        action(this: CommandContext, target: string): void {
            if (!target) {
                let status = '<div style="padding: 10px; border: 1px solid #ccc; border-radius: 5px;">';
                status += '<h3>AI Content Filter Status</h3>';
                status += '<p><strong>Filter Enabled:</strong> ' + (AI_CONFIG.ENABLE_CONTENT_FILTER ? 'Yes' : 'No') + '</p>';
                status += '<p><strong>Filter Action:</strong> ' + AI_CONFIG.FILTER_ACTION + '</p>';
                status += '<p><strong>Strike System:</strong> ' + (AI_CONFIG.STRIKE_SYSTEM_ENABLED ? 'Enabled' : 'Disabled') + '</p>';
                status += '<p><strong>Max Strikes:</strong> ' + AI_CONFIG.MAX_STRIKES + '</p>';
                status += '<h4>Filter Categories:</h4>';
                status += '<ul>';
                
                FILTER_CATEGORIES.forEach(category => {
                    status += '<li><strong>' + category.name + '</strong> (' + category.severity + '): ';
                    status += (category.enabled ? 'Enabled' : 'Disabled') + ' - ' + category.keywords.length + ' keywords</li>';
                });
                
                status += '</ul></div>';
                return this.sendReplyBox(status);
            }

            const [action, ...params] = target.split(' ');
            
            switch (action.toLowerCase()) {
                case 'enable':
                    AI_CONFIG.ENABLE_CONTENT_FILTER = true;
                    this.sendReply("Content filtering enabled.");
                    break;
                
                case 'disable':
                    AI_CONFIG.ENABLE_CONTENT_FILTER = false;
                    this.sendReply("Content filtering disabled.");
                    break;
                
                case 'action':
                    const newAction = params[0];
                    if (['block', 'warn', 'log'].includes(newAction)) {
                        AI_CONFIG.FILTER_ACTION = newAction as 'block' | 'warn' | 'log';
                        this.sendReply(`Filter action set to: ${newAction}`);
                    } else {
                        this.errorReply("Valid actions: block, warn, log");
                    }
                    break;
                
                case 'strikes':
                    const maxStrikes = parseInt(params[0]);
                    if (maxStrikes > 0 && maxStrikes <= 10) {
                        AI_CONFIG.MAX_STRIKES = maxStrikes;
                        this.sendReply(`Max strikes set to: ${maxStrikes}`);
                    } else {
                        this.errorReply("Max strikes must be between 1 and 10");
                    }
                    break;
                
                case 'category':
                    const [categoryName, categoryAction] = params;
                    const category = FILTER_CATEGORIES.find(c => c.name === categoryName);
                    if (category) {
                        if (categoryAction === 'enable') {
                            category.enabled = true;
                            this.sendReply(`Category "${categoryName}" enabled.`);
                        } else if (categoryAction === 'disable') {
                            category.enabled = false;
                            this.sendReply(`Category "${categoryName}" disabled.`);
                        } else {
                            this.errorReply("Use: /askaifilter category <name> <enable|disable>");
                        }
                    } else {
                        this.errorReply("Category not found. Available categories: " + FILTER_CATEGORIES.map(c => c.name).join(', '));
                    }
                    break;
                
                default:
                    this.errorReply("Usage: /askaifilter [enable|disable|action <type>|strikes <num>|category <name> <enable|disable>]");
            }
        },
        help: ["/askaifilter - Manage AI content filtering settings. Requires driver or higher."]
    },

    askaistrikes: {
        permission: ['voice', 'driver', 'moderator', 'roomowner', 'administrator'],
        action(this: CommandContext, target: string, room: Room | undefined, user: User): void {
            if (!target) {
                // Show own strikes
                const strikes = getUserStrikes(user.userid);
                if (strikes.count === 0) {
                    return this.sendReply("You have no content violations.");
                }
                
                const recentViolations = strikes.violations.slice(-3).join(', ');
                return this.sendReply('You have ' + strikes.count + '/' + AI_CONFIG.MAX_STRIKES + ' strikes. Recent violations: ' + recentViolations);
            }
            
            // Moderators can check other users' strikes
            if (!user.can('mute')) {
                return this.errorReply("You can only check your own strikes.");
            }
            
            const targetUser = target.toLowerCase();
            const strikes = getUserStrikes(targetUser);
            
            if (strikes.count === 0) {
                return this.sendReply(target + ' has no content violations.');
            }
            
            const lastStrike = new Date(strikes.lastStrike).toLocaleString();
            const violations = strikes.violations.join(', ');
            
            this.sendReply(target + ': ' + strikes.count + '/' + AI_CONFIG.MAX_STRIKES + ' strikes. Last strike: ' + lastStrike + '. Violations: ' + violations);
        },
        help: ["/askaistrikes [user] - Check AI content violation strikes"]
    },

    askaihelp: {
        permission: ['voice', 'driver', 'moderator', 'bot', 'roomowner', 'administrator'],
        action(this: CommandContext): void {
            return this.parse('/help askai');
        }
    }
};

// Plugin info interface
interface PluginInfo {
    name: string;
    description: string;
    version: string;
    author: string;
}

// Export plugin info
export const info: PluginInfo = {
    name: 'AI Chat Plugin',
    description: 'Allows users to ask questions to Google Gemini AI',
    version: '1.0.0',
    author: 'Pokemon Showdown Plugin Developer'
};