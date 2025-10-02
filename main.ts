import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, requestUrl, Editor, moment, Modal, MarkdownView, MarkdownRenderer, Platform, ItemView, WorkspaceLeaf, TFolder } from 'obsidian';
const ExifReader = require('exif-reader');

// Helper function to convert ArrayBuffer to Base64 (works on mobile)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// Constants
const GEMINI_CHAT_VIEW = 'gemini-chat-view';

// Interfaces
interface GPSCoordinates {
    latitude: number;
    longitude: number;
}

interface TriggerAction {
    keyword: string;
    action: string;
    requiresList: boolean;
    enabled: boolean;
}

interface Notebook {
    id: string;
    name: string;
    startDate: string;
    endDate?: string;
    totalPages?: number;
    currentPage: number;
    status: 'active' | 'completed' | 'archived';
    color?: string;
    description?: string;
}

// Add these interfaces to your existing interfaces section
interface FolderMonitorSettings {
    enabled: boolean;
    watchFolder: string;
    filePattern: string;
    processedFolder: string;
    outputFolder: string;
    deleteAfterProcessing: boolean;
    checkInterval: number; // in seconds
    useNotebook: boolean;
    notebookId: string;
    autoIncrementPages: boolean;
    lastProcessedTime: number;
}


const DEFAULT_TRIGGER_ACTIONS: TriggerAction[] = [
    { keyword: 'Research', action: 'research', requiresList: true, enabled: true },
    { keyword: 'Expand', action: 'expand', requiresList: false, enabled: true },
    { keyword: 'Summarize', action: 'summarize', requiresList: false, enabled: true },
    { keyword: 'Summarise', action: 'summarize', requiresList: false, enabled: true }, // UK spelling
    { keyword: 'Actions', action: 'actions', requiresList: false, enabled: true },
    { keyword: 'Tasks', action: 'tasks', requiresList: true, enabled: true },
    { keyword: 'Analyze', action: 'analyze', requiresList: false, enabled: true },
    { keyword: 'Analyse', action: 'analyze', requiresList: false, enabled: true }, // UK spelling
    { keyword: 'Define', action: 'define', requiresList: true, enabled: true },
    { keyword: 'Translate', action: 'translate', requiresList: false, enabled: true },
    { keyword: 'Rewrite', action: 'rewrite', requiresList: false, enabled: true },
    { keyword: 'Questions', action: 'questions', requiresList: false, enabled: true },
    { keyword: 'Connect', action: 'connect', requiresList: false, enabled: true },
    { keyword: 'Organise', action: 'organize', requiresList: false, enabled: true }, // UK spelling
    { keyword: 'Organize', action: 'organize', requiresList: false, enabled: true }, // US spelling
    { keyword: 'TagLinks', action: 'taglinks', requiresList: false, enabled: true },
    { keyword: 'Related', action: 'related', requiresList: false, enabled: true }
];

const DEFAULT_GEMINI_PROMPT = `You are an expert note-processing assistant integrated into Obsidian. I am providing you with an image of a handwritten note.
Perform the following tasks and format your response *exactly* as specified below, using Markdown.
Do not include any other text, headers, or pleasantries in your response.

IMPORTANT: When transcribing, preserve formatting indicators:
- If a word appears underlined in the handwriting, format it as <u>word</u>
- Maintain numbered or bulleted lists exactly as they appear
- Keep the exact structure and organization of the original note

### Transcript
[Provide a full, verbatim transcript of the text in the image here, preserving all formatting indicators as specified above.]

### Summary
[Provide a concise bullet-point summary of the key points.]

### Tasks
[Extract any actionable tasks or to-do items from the note. Format each as a checkbox item using "- [ ]" followed by the task description.
Include any time indicators mentioned with the task:
- If a due date is mentioned (e.g., "by Friday", "due tomorrow", "by tonight", "before June 1"), include it as "DUE: [date]"
- If a scheduled/planned date is mentioned (e.g., "scheduled for Monday", "on the 15th"), include it as "SCHEDULED: [date]"
- If a start date is mentioned (e.g., "start next week", "begin in January"), include it as "START: [date]"
- If priority is indicated (!, !!, !!!), include it at the beginning
Example format: "- [ ] !!! Task description DUE: tomorrow SCHEDULED: Monday"
If no tasks are found, write "None identified."]

### Detected Tags
[Identify any hashtags (e.g., #idea, #meeting) in the text. List them here as a comma-separated list, without the '#' symbol. For example: idea, meeting, project-alpha. If none are found, write "None identified."]`;

interface GeminiNoteProcessorSettings {
    geminiApiKey: string;
    selectedModel: string;
    customTags: string;
    enableDeepResearch: boolean;
    newNoteLocation: string;
    attachmentLocation: string;
    enableLocationTagging: boolean;
    fallbackToCurrentLocation: boolean;
    enableTriggerWords: boolean;
    researchResponseLength: 'brief' | 'moderate' | 'detailed';
    triggerActions: TriggerAction[];
    notebooks: Notebook[];
    currentNotebookId: string;
    autoIncrementPage: boolean;
    insertPageNumbers: boolean;
    groupByNotebook: boolean;
    notebookFolderPattern: string;
    androidCameraMode: 'camera' | 'gallery' | 'ask';
    enableTasksIntegration: boolean;
    tasksNotePath: string;
    tasksSectionHeading: string;
    taskPriorities: boolean;
    defaultTaskTags: string;
    geminiPrompt: string;
    enableDiscussionLinks: boolean;
    discussionLinkText: string;
    folderMonitor: FolderMonitorSettings;
}

const DEFAULT_SETTINGS: GeminiNoteProcessorSettings = {
    geminiApiKey: '',
    selectedModel: 'gemini-1.5-flash-latest',
    customTags: 'sketchnote, from-notebook',
    enableDeepResearch: false,
    newNoteLocation: 'Gemini Scans/YYYY',
    attachmentLocation: 'Gemini Scans/YYYY/Attachments',
    enableLocationTagging: false,
    fallbackToCurrentLocation: false,
    enableTriggerWords: false,
    researchResponseLength: 'moderate',
    triggerActions: DEFAULT_TRIGGER_ACTIONS,
    notebooks: [],
    currentNotebookId: '',
    autoIncrementPage: true,
    insertPageNumbers: true,
    groupByNotebook: true,
    notebookFolderPattern: 'Notebooks/{notebook}',
    androidCameraMode: 'ask',
    enableTasksIntegration: false,
    tasksNotePath: 'Tasks/Inbox.md',
    tasksSectionHeading: '## Captured Tasks',
    taskPriorities: true,
    defaultTaskTags: '#task',
    geminiPrompt: DEFAULT_GEMINI_PROMPT,
    enableDiscussionLinks: true,
    discussionLinkText: '💬 Discuss this note with Gemini',
    folderMonitor: {
        enabled: false,
        watchFolder: 'Inbox',
        filePattern: 'scan-*',
        processedFolder: 'Inbox/Processed',
        outputFolder: 'Gemini Scans/Auto-Processed',
        deleteAfterProcessing: false,
        checkInterval: 30,
        useNotebook: false,
        notebookId: '',
        autoIncrementPages: true,
        lastProcessedTime: 0
    }
}

// Chat View Class
export class GeminiChatView extends ItemView {
    plugin: GeminiNoteProcessor;
    noteContent: string;
    sourceFile: TFile | null;
    chatContainer: HTMLElement;
    inputField: HTMLTextAreaElement;
    sendButton: HTMLButtonElement;
    sourceFileDisplay: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: GeminiNoteProcessor) {
        super(leaf);
        this.plugin = plugin;
        this.noteContent = '';
        this.sourceFile = null;
    }

    getViewType() {
        return GEMINI_CHAT_VIEW;
    }

    getDisplayText() {
        return 'Gemini Chat';
    }

    getIcon() {
        return 'message-circle';
    }

    async onOpen() {
        const containerEl = this.containerEl.children[1];
        if (!(containerEl instanceof HTMLElement)) {
            console.error('Container element is not an HTMLElement');
            return;
        }
        const container = containerEl;
        container.empty();
        container.addClass('gemini-chat-view');

        // Create chat UI
        this.createChatInterface(container);

        // Load current note if available
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            await this.loadNote(activeFile);
        }
    }

    createChatInterface(container: HTMLElement) {
        // Make container flex
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            height: 100%;
        `;

        // Header
        const header = container.createDiv({ cls: 'gemini-chat-header' });
        header.style.cssText = `
            padding: 10px;
            border-bottom: 1px solid var(--background-modifier-border);
            background: var(--background-secondary);
            flex-shrink: 0;
        `;

        const titleEl = header.createEl('h4', { text: 'Chat with Gemini' });
        titleEl.style.cssText = 'margin: 0; font-size: 14px;';

        this.sourceFileDisplay = header.createEl('div', {
            cls: 'source-file',
            text: 'No note loaded'
        });
        this.sourceFileDisplay.style.cssText = `
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 4px;
        `;

        // Chat messages container
        this.chatContainer = container.createDiv({ cls: 'gemini-chat-messages' });
        this.chatContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 15px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;

        // Input area at bottom
        const inputArea = container.createDiv({ cls: 'gemini-chat-input' });
        inputArea.style.cssText = `
            padding: 10px;
            border-top: 1px solid var(--background-modifier-border);
            background: var(--background-primary);
            flex-shrink: 0;
        `;

        // Quick actions
        const quickActions = inputArea.createDiv({ cls: 'quick-actions' });
        quickActions.style.cssText = `
            display: flex;
            gap: 5px;
            margin-bottom: 8px;
            flex-wrap: wrap;
        `;

        const quickPrompts = [
            { icon: '💡', text: 'Elaborate', prompt: 'Can you elaborate on the main points?' },
            { icon: '❓', text: 'Questions', prompt: 'What questions should I be asking?' },
            { icon: '🔗', text: 'Related', prompt: 'What related topics should I explore?' }
        ];

        quickPrompts.forEach(({ icon, text, prompt }) => {
            const btn = quickActions.createEl('button', {
                text: `${icon} ${text}`,
                cls: 'clickable-icon'
            });
            btn.style.cssText = 'font-size: 11px; padding: 3px 6px;';
            btn.onclick = () => {
                this.inputField.value = prompt;
                this.sendMessage();
            };
        });

        // Input container
        const inputContainer = inputArea.createDiv({ cls: 'input-container' });
        inputContainer.style.cssText = 'display: flex; gap: 8px;';

        this.inputField = inputContainer.createEl('textarea', {
            cls: 'gemini-input',
            attr: {
                placeholder: 'Ask Gemini about this note...',
                rows: '2'
            }
        });
        this.inputField.style.cssText = `
            flex: 1;
            resize: none;
            padding: 8px;
            border-radius: 6px;
            border: 1px solid var(--background-modifier-border);
            font-size: 14px;
        `;

        this.sendButton = inputContainer.createEl('button', {
            cls: 'mod-cta',
            text: '➤'
        });
        this.sendButton.style.cssText = `
            width: 40px;
            height: 40px;
            border-radius: 50%;
            align-self: flex-end;
        `;

        // Event handlers
        this.sendButton.onclick = () => this.sendMessage();
        this.inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Auto-resize textarea
        this.inputField.addEventListener('input', () => {
            this.inputField.style.height = 'auto';
            this.inputField.style.height = Math.min(this.inputField.scrollHeight, 120) + 'px';
        });
    }

    async loadNote(file: TFile) {
        this.sourceFile = file;
        this.noteContent = await this.app.vault.read(file);
        this.sourceFileDisplay.setText(`Discussing: ${file.basename}`);

        // Clear previous chat
        this.chatContainer.empty();

        // Load existing discussion if it exists
        const discussionPath = await this.getDiscussionPath(file);
        const discussionFile = this.app.vault.getAbstractFileByPath(discussionPath);

        if (discussionFile instanceof TFile) {
            const content = await this.app.vault.read(discussionFile);
            const entries = this.parseDiscussionHistory(content);

            entries.forEach(entry => {
                this.addMessage(entry.question, 'user');
                this.addMessage(entry.response, 'assistant');
            });

            if (entries.length > 0) {
                this.addDivider('Previous discussion loaded');
            }
        }

        // Add welcome message if no history
        if (this.chatContainer.children.length === 0) {
            this.addMessage(`I'm ready to discuss "${file.basename}". What would you like to know?`, 'assistant');
        }
    }

    async sendMessage() {
        const message = this.inputField.value.trim();
        if (!message || !this.sourceFile) return;

        // Disable input
        this.inputField.disabled = true;
        this.sendButton.disabled = true;

        // Add user message
        this.addMessage(message, 'user');

        // Clear input
        this.inputField.value = '';
        this.inputField.style.height = 'auto';

        // Add loading indicator
        const loadingEl = this.addMessage('Thinking...', 'assistant');
        loadingEl.style.opacity = '0.6';

        try {
            // Get response from Gemini
            const response = await this.plugin.discussWithGemini(this.noteContent, message);

            // Remove loading
            this.chatContainer.removeChild(loadingEl);

            // Add response
            this.addMessage(response, 'assistant');

            // Save to discussion file
            if (this.sourceFile) {
                const discussionPath = await this.getDiscussionPath(this.sourceFile);
                await this.plugin.appendToDiscussionFile(
                    discussionPath,
                    message,
                    response,
                    this.sourceFile
                );
            }
        } catch (error) {
            this.chatContainer.removeChild(loadingEl);
            this.addMessage('Failed to get response. Please try again.', 'error');
            console.error('Gemini chat error:', error);
        } finally {
            this.inputField.disabled = false;
            this.sendButton.disabled = false;
            this.inputField.focus();
        }
    }

    addMessage(content: string, type: 'user' | 'assistant' | 'error'): HTMLElement {
        const messageEl = this.chatContainer.createDiv({
            cls: `gemini-message gemini-message-${type}`
        });

        const baseStyle = `
            padding: 10px 14px;
            border-radius: 12px;
            max-width: 85%;
            word-wrap: break-word;
        `;

        if (type === 'user') {
            messageEl.style.cssText = baseStyle + `
                background: var(--interactive-accent);
                color: var(--text-on-accent);
                align-self: flex-end;
                margin-left: auto;
            `;
        } else if (type === 'assistant') {
            messageEl.style.cssText = baseStyle + `
                background: var(--background-secondary);
                align-self: flex-start;
            `;
        } else {
            messageEl.style.cssText = baseStyle + `
                background: var(--background-modifier-error);
                align-self: center;
            `;
        }

        // Render markdown
        MarkdownRenderer.renderMarkdown(content, messageEl, '', this.plugin);

        // Scroll to bottom
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;

        return messageEl;
    }

    addDivider(text: string) {
        const divider = this.chatContainer.createDiv({ cls: 'chat-divider' });
        divider.style.cssText = `
            text-align: center;
            color: var(--text-muted);
            font-size: 11px;
            margin: 10px 0;
            position: relative;
        `;
        divider.setText(text);
    }

    async getDiscussionPath(file: TFile): Promise<string> {
        const folder = file.parent?.path || '';
        const name = `${file.basename} - Discussion.md`;
        return folder ? `${folder}/${name}` : name;
    }

    parseDiscussionHistory(content: string): Array<{ question: string, response: string }> {
        const entries: Array<{ question: string, response: string }> = [];
        const entryRegex = /## Discussion Entry - .*?\n\n\*\*Question:\*\* (.*?)\n\n\*\*Gemini's Response:\*\*\n([\s\S]*?)(?=\n---\n|$)/g;
        let match;

        while ((match = entryRegex.exec(content)) !== null) {
            entries.push({
                question: match[1],
                response: match[2].trim()
            });
        }

        return entries;
    }

    async onClose() {
        // Cleanup if needed
    }
}


// Add this class to handle folder monitoring
class FolderMonitor {
    private plugin: GeminiNoteProcessor;
    private intervalId: number | null = null;
    private isProcessing: boolean = false;
    private processedFiles: Set<string> = new Set();

    constructor(plugin: GeminiNoteProcessor) {
        this.plugin = plugin;
    }

    // Public method to check if monitor is running
    public isRunning(): boolean {
        return this.intervalId !== null;
    }

    start() {
        if (!this.plugin.settings.folderMonitor.enabled) {
            return;
        }

        console.log('Starting folder monitor for:', this.plugin.settings.folderMonitor.watchFolder);

        // Clear any existing interval
        this.stop();

        // Initial check
        this.checkFolder();

        // Set up interval
        const intervalMs = this.plugin.settings.folderMonitor.checkInterval * 1000;
        this.intervalId = window.setInterval(() => {
            this.checkFolder();
        }, intervalMs);
    }

    stop() {
        if (this.intervalId) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('Stopped folder monitor');
        }
    }

    async checkFolder() {
        if (this.isProcessing) {
            console.log('Folder monitor: Already processing, skipping check');
            return;
        }

        const settings = this.plugin.settings.folderMonitor;
        const folder = this.plugin.app.vault.getAbstractFileByPath(settings.watchFolder);

        if (!folder || !(folder instanceof TFolder)) {
            console.log('Watch folder not found:', settings.watchFolder);
            return;
        }

        // Get all files matching the pattern
        const files = await this.getMatchingFiles(folder);

        if (files.length === 0) {
            return;
        }

        console.log(`Found ${files.length} files to process`);
        this.isProcessing = true;

        try {
            await this.processFiles(files);
        } catch (error) {
            console.error('Error processing files:', error);
            new Notice('Folder monitor: Error processing files. Check console.');
        } finally {
            this.isProcessing = false;
        }
    }

    async getMatchingFiles(folder: TFolder): Promise<TFile[]> {
        const settings = this.plugin.settings.folderMonitor;
        const matchingFiles: TFile[] = [];

        // Create regex pattern from the file pattern
        // Convert wildcards to regex: * -> .*, ? -> .
        const regexPattern = settings.filePattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
            .replace(/\*/g, '.*') // Replace * with .*
            .replace(/\?/g, '.'); // Replace ? with .

        const regex = new RegExp(`^${regexPattern}\\.(png|pdf)$`, 'i');

        for (const child of folder.children) {
            if (child instanceof TFile) {
                // Check if file matches pattern
                if (!regex.test(child.name)) {
                    continue;
                }

                // Check if file was created after last processed time
                if (child.stat.ctime <= settings.lastProcessedTime) {
                    continue;
                }

                // Check if we've already processed this file in this session
                if (this.processedFiles.has(child.path)) {
                    continue;
                }

                matchingFiles.push(child);
            }
        }

        return matchingFiles;
    }

    async processFiles(files: TFile[]) {
        const settings = this.plugin.settings.folderMonitor;
        let notebook: Notebook | null = null;
        let currentPageNumber: number | null = null;

        if (settings.useNotebook && settings.notebookId) {
            notebook = this.plugin.settings.notebooks.find(n => n.id === settings.notebookId) || null;
            currentPageNumber = notebook?.currentPage || null;
        }

        const progressNotice = new Notice(`Processing ${files.length} files from monitored folder...`, 0);

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            progressNotice.setMessage(`Processing ${i + 1}/${files.length}: ${file.name}`);

            try {
                if (file.extension.toLowerCase() === 'pdf') {
                    // Handle PDF processing
                    await this.processPdfFile(file, notebook, currentPageNumber);
                } else {
                    // Handle image processing
                    await this.processImageFile(file, notebook, currentPageNumber);
                }

                // Mark as processed
                this.processedFiles.add(file.path);

                // Update page number if using notebook
                if (notebook && currentPageNumber && settings.autoIncrementPages) {
                    currentPageNumber++;
                    notebook.currentPage = currentPageNumber;
                }

                // Move or delete the original file
                await this.handleProcessedFile(file);

                // Small delay between files
                if (i < files.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

            } catch (error) {
                console.error(`Failed to process ${file.name}:`, error);
                new Notice(`Failed to process ${file.name}`);
            }
        }

        // Update last processed time
        settings.lastProcessedTime = Date.now();
        await this.plugin.saveSettings();

        // Update notebook if used
        if (notebook) {
            await this.plugin.saveSettings();
        }

        progressNotice.hide();
        new Notice(`✅ Processed ${files.length} files from monitored folder`);
    }

    async processImageFile(file: TFile, notebook: Notebook | null, pageNumber: number | null) {
        const settings = this.plugin.settings.folderMonitor;

        // Read the image data
        const imageData = await this.plugin.app.vault.readBinary(file);

        // Call Gemini API
        let resultText = await this.plugin.callGeminiAPI(imageData);
        if (!resultText) throw new Error("API call returned no text.");

        // Process triggers if enabled
        if (this.plugin.settings.enableTriggerWords) {
            resultText = await this.plugin.processTriggersInText(resultText);
        }

        // Extract location if enabled
        let locationTag: string | null = null;
        if (this.plugin.settings.enableLocationTagging) {
            locationTag = await this.plugin.extractLocationFromImage(imageData);
        }

        // Parse detected tags
        const detectedTags = this.plugin.parseDetectedTags(resultText);

        // Create the output folder
        const outputFolder = await this.plugin.getAndEnsureFolder(settings.outputFolder);

        // Create note
        const timestamp = window.moment().format('YYYY-MM-DD HH-mm-ss');
        const baseName = file.basename;

        let noteFileName: string;
        if (notebook && pageNumber) {
            noteFileName = `${baseName} - Page ${pageNumber} - Auto.md`;
        } else {
            noteFileName = `${baseName} - ${timestamp}.md`;
        }

        const noteFilePath = outputFolder ? `${outputFolder}/${noteFileName}` : noteFileName;

        // Build note content
        let noteContent = '';

        if (this.plugin.settings.enableDiscussionLinks) {
            const encodedPath = encodeURIComponent(noteFilePath);
            noteContent += `[${this.plugin.settings.discussionLinkText}](obsidian://gemini-discuss?file=${encodedPath})\n\n`;
        }

        // Copy the image to attachments folder if needed
        const attachmentFolder = await this.plugin.getAndEnsureFolder(this.plugin.settings.attachmentLocation);
        const newImagePath = `${attachmentFolder}/${file.name}`;

        // Copy file if not deleting original
        if (!settings.deleteAfterProcessing) {
            await this.plugin.app.vault.copy(file, newImagePath);
            noteContent += `![[${newImagePath}]]\n`;
        } else {
            noteContent += `![[${file.path}]]\n`;
        }

        noteContent += `\n> **Source:** Auto-processed from monitored folder\n`;
        noteContent += `> **Original file:** ${file.name}\n`;

        if (notebook && pageNumber) {
            noteContent += `> **Notebook:** ${notebook.name} | **Page:** ${pageNumber}\n`;
        }

        noteContent += `\n---\n${resultText}\n---`;

        // Create the note
        const newNoteFile = await this.plugin.app.vault.create(noteFilePath, noteContent);

        // Update note properties
        const imageFile = settings.deleteAfterProcessing ? file : this.plugin.app.vault.getAbstractFileByPath(newImagePath) as TFile;
        await this.plugin.updateNoteProperties(imageFile, newNoteFile, detectedTags, locationTag, notebook?.id || null, pageNumber);
    }

    async processPdfFile(file: TFile, notebook: Notebook | null, pageNumber: number | null) {
        // For PDF files, we need to extract pages as images first
        // This is a simplified version - you might want to use a PDF processing library
        new Notice(`PDF processing not fully implemented yet for ${file.name}`);

        // For now, just copy the PDF to the output folder
        const settings = this.plugin.settings.folderMonitor;
        const outputFolder = await this.plugin.getAndEnsureFolder(settings.outputFolder);
        const newPath = `${outputFolder}/${file.name}`;

        if (!settings.deleteAfterProcessing) {
            await this.plugin.app.vault.copy(file, newPath);
        }
    }

    async handleProcessedFile(file: TFile) {
        const settings = this.plugin.settings.folderMonitor;

        if (settings.deleteAfterProcessing) {
            await this.plugin.app.vault.delete(file);
            console.log(`Deleted processed file: ${file.name}`);
        } else {
            // Move to processed folder
            const processedFolder = await this.plugin.getAndEnsureFolder(settings.processedFolder);
            const newPath = `${processedFolder}/${file.name}`;

            try {
                await this.plugin.app.fileManager.renameFile(file, newPath);
                console.log(`Moved processed file to: ${newPath}`);
            } catch (error) {
                console.error(`Failed to move file ${file.name}:`, error);
            }
        }
    }
}


// Main Plugin Class
export default class GeminiNoteProcessor extends Plugin {
    settings: GeminiNoteProcessorSettings;
    folderMonitor: FolderMonitor;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new GeminiSettingTab(this.app, this));

        // Register the chat view
        this.registerView(
            GEMINI_CHAT_VIEW,
            (leaf) => new GeminiChatView(leaf, this)
        );

        this.addRibbonIcon('camera', 'Create note from camera or file', () => {
            this.createNoteFromImageCapture();
        });

        // Add command to open chat view
        this.addCommand({
            id: 'open-gemini-chat',
            name: 'Open Gemini Chat',
            callback: () => this.activateChatView()
        });

        // Add command for processing current image
        this.addCommand({
            id: 'process-current-image',
            name: 'Process current image with Gemini',
            checkCallback: (checking: boolean) => {
                const file = this.app.workspace.getActiveFile();
                if (file && file.extension.match(/^(png|jpg|jpeg|gif)$/i)) {
                    if (!checking) {
                        this.processExistingImage(file);
                    }
                    return true;
                }
                return false;
            }
        });

        // Add command for batch processing
        this.addCommand({
            id: 'batch-process-images',
            name: 'Batch process images in folder',
            callback: () => {
                this.showBatchProcessModal();
            }
        });

        // Register the protocol handler for discussion links
        this.registerObsidianProtocolHandler('gemini-discuss', async (params) => {
            const filePath = decodeURIComponent(params.file);
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.activateChatView();
                const view = this.getChatView();
                if (view) {
                    await view.loadNote(file);
                }
            }
        });

        // Add command for discussing current note
        this.addCommand({
            id: 'discuss-with-gemini',
            name: 'Discuss current note with Gemini',
            editorCallback: async (editor: Editor) => {
                const file = this.app.workspace.getActiveFile();
                if (file) {
                    await this.activateChatView();
                    const view = this.getChatView();
                    if (view) {
                        await view.loadNote(file);
                    }
                }
            }
        });

        // Auto-load note when file changes
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', async (leaf) => {
                const view = this.getChatView();
                if (view && leaf?.view instanceof MarkdownView) {
                    const file = leaf.view.file;
                    if (file) {
                        await view.loadNote(file);
                    }
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (!(file instanceof TFile) || !file.path.match(/\.(png|jpg|jpeg|gif)$/i)) {
                    return;
                }
                menu.addItem((item) => {
                    item.setTitle("Process note with Gemini").setIcon("sparkle")
                        .onClick(async () => {
                            this.processImageInCurrentNote(file);
                        });
                });
            })
        );
        
        // Initialize folder monitor
        this.folderMonitor = new FolderMonitor(this);

        // Start monitor if enabled
        if (this.settings.folderMonitor.enabled) {
            this.folderMonitor.start();
        }

        // Add command to manually trigger folder check
        this.addCommand({
            id: 'check-monitored-folder',
            name: 'Check monitored folder now',
            callback: () => {
                if (this.settings.folderMonitor.enabled) {
                    this.folderMonitor.checkFolder();
                    new Notice('Checking monitored folder...');
                } else {
                    new Notice('Folder monitoring is disabled. Enable it in settings.');
                }
            }
        });
    }

    onunload() { 
        // Stop folder monitor
        if (this.folderMonitor) {
            this.folderMonitor.stop();
        }
    }

    async activateChatView() {
        const existing = this.app.workspace.getLeavesOfType(GEMINI_CHAT_VIEW);

        if (existing.length) {
            // Reveal existing view
            this.app.workspace.revealLeaf(existing[0]);
            return existing[0];
        }

        // Create new view in right sidebar
        const rightLeaf = this.app.workspace.getRightLeaf(false);
        if (rightLeaf) {
            await rightLeaf.setViewState({
                type: GEMINI_CHAT_VIEW,
                active: true
            });
            this.app.workspace.revealLeaf(rightLeaf);
            return rightLeaf;
        }
    }

    getChatView(): GeminiChatView | null {
        const leaves = this.app.workspace.getLeavesOfType(GEMINI_CHAT_VIEW);
        if (leaves.length) {
            return leaves[0].view as GeminiChatView;
        }
        return null;
    }

    async loadSettings() {
        const loadedData = await this.loadData();
        // Deep merge for nested settings like folderMonitor
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...loadedData,
            folderMonitor: {
                ...DEFAULT_SETTINGS.folderMonitor,
                ...(loadedData?.folderMonitor || {})
            }
        };

        // Ensure all required settings exist
        if (!this.settings.triggerActions) {
            this.settings.triggerActions = DEFAULT_TRIGGER_ACTIONS;
        }
        if (!this.settings.notebooks) {
            this.settings.notebooks = [];
        }
        if (this.settings.enableTasksIntegration === undefined) {
            this.settings.enableTasksIntegration = false;
        }
        if (!this.settings.tasksNotePath) {
            this.settings.tasksNotePath = 'Tasks/Inbox.md';
        }
        if (!this.settings.tasksSectionHeading) {
            this.settings.tasksSectionHeading = '## Captured Tasks';
        }
        if (this.settings.taskPriorities === undefined) {
            this.settings.taskPriorities = true;
        }
        if (!this.settings.defaultTaskTags) {
            this.settings.defaultTaskTags = '#captured';
        }
        // Ensure geminiPrompt is always set
        if (!this.settings.geminiPrompt || this.settings.geminiPrompt.trim() === '') {
            console.log('Initializing Gemini prompt to default');
            this.settings.geminiPrompt = DEFAULT_GEMINI_PROMPT;
            await this.saveSettings();
        }
        // Initialize discussion settings
        if (this.settings.enableDiscussionLinks === undefined) {
            this.settings.enableDiscussionLinks = true;
        }
        if (!this.settings.discussionLinkText) {
            this.settings.discussionLinkText = '💬 Discuss this note with Gemini';
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // Enhanced method for processing existing images
    async processExistingImage(file: TFile, options?: {
        createNewNote?: boolean,
        insertInCurrentNote?: boolean,
        notebook?: Notebook | null,
        pageNumber?: number | null
    }) {
        const defaults = {
            createNewNote: false,
            insertInCurrentNote: true,
            notebook: null,
            pageNumber: null
        };
        const opts = { ...defaults, ...options };

        if (!this.settings.geminiApiKey) {
            new Notice("Gemini API key is not set.");
            return;
        }

        // Check if user wants to choose processing method
        if (!opts.createNewNote && !opts.insertInCurrentNote) {
            const choice = await this.showImageProcessingChoiceModal(file);
            if (!choice) return;
            opts.createNewNote = choice === 'new';
            opts.insertInCurrentNote = choice === 'current';
        }

        new Notice(`Processing ${file.name} with Gemini...`);

        try {
            const imageData = await this.app.vault.readBinary(file);
            let resultText = await this.callGeminiAPI(imageData);

            if (!resultText) throw new Error("API call returned no text.");

            if (this.settings.enableTriggerWords) {
                resultText = await this.processTriggersInText(resultText);
            }

            let locationTag: string | null = null;
            if (this.settings.enableLocationTagging) {
                locationTag = await this.extractLocationFromImage(imageData);
            }

            const detectedTags = this.parseDetectedTags(resultText);

            if (opts.createNewNote) {
                // Create a new note for this image
                await this.createNoteFromExistingImage(file, resultText, detectedTags, locationTag, opts.notebook, opts.pageNumber);
            } else if (opts.insertInCurrentNote) {
                // Insert in current note
                const noteFile = this.app.workspace.getActiveFile();
                if (noteFile && noteFile.extension === 'md') {
                    await this.insertProcessedTextInNote(noteFile, file, resultText, detectedTags, locationTag);
                } else {
                    new Notice("No active markdown file to insert into. Creating new note instead.");
                    await this.createNoteFromExistingImage(file, resultText, detectedTags, locationTag, opts.notebook, opts.pageNumber);
                }
            }

            new Notice(`Successfully processed ${file.name}!`);
        } catch (error) {
            console.error("Error processing existing image:", error);
            new Notice(`Failed to process ${file.name}. Check console.`);
        }
    }

    // New method to create note from existing image
    async createNoteFromExistingImage(
        imageFile: TFile,
        resultText: string,
        detectedTags: string[],
        locationTag: string | null,
        notebook: Notebook | null,
        pageNumber: number | null
    ) {
        let noteFolder = "";
        if (notebook && this.settings.groupByNotebook) {
            noteFolder = await this.getAndEnsureFolder(await this.getNotebookFolder(notebook.id));
        } else {
            noteFolder = await this.getAndEnsureFolder(this.settings.newNoteLocation);
        }

        const timestamp = window.moment().format('YYYY-MM-DD HH-mm-ss');
        const baseName = imageFile.basename;

        let noteFileName: string;
        if (notebook && pageNumber) {
            noteFileName = `${baseName} - Page ${pageNumber} - Processed.md`;
        } else {
            noteFileName = `${baseName} - Processed ${timestamp}.md`;
        }

        const noteFilePath = noteFolder ? `${noteFolder}/${noteFileName}` : noteFileName;

        // Build note content
        let noteContent = '';

        if (this.settings.enableDiscussionLinks) {
            const encodedPath = encodeURIComponent(noteFilePath);
            noteContent += `[${this.settings.discussionLinkText}](obsidian://gemini-discuss?file=${encodedPath})\n\n`;
        }

        noteContent += `![[${imageFile.path}]]\n`;
        noteContent += `\n> **Source:** Existing image processed on ${window.moment().format('YYYY-MM-DD')}\n`;

        if (notebook && pageNumber) {
            noteContent += `> **Notebook:** ${notebook.name} | **Page:** ${pageNumber}\n`;
        }

        noteContent += `\n---\n${resultText}\n---`;

        const newNoteFile = await this.app.vault.create(noteFilePath, noteContent);
        await this.updateNoteProperties(imageFile, newNoteFile, detectedTags, locationTag, notebook?.id || null, pageNumber);

        this.app.workspace.openLinkText(newNoteFile.path, '', true);
    }

    // Method to insert processed text in current note
    async insertProcessedTextInNote(
        noteFile: TFile,
        imageFile: TFile,
        resultText: string,
        detectedTags: string[],
        locationTag: string | null
    ) {
        const editor = this.app.workspace.activeEditor?.editor;
        if (!editor) return;

        const cursor = editor.getCursor();
        const lineContent = editor.getLine(cursor.line);

        // Build insert text
        let insertText = '\n\n';

        // Add discussion link if enabled
        if (this.settings.enableDiscussionLinks) {
            const encodedPath = encodeURIComponent(noteFile.path);
            insertText += `[${this.settings.discussionLinkText}](obsidian://gemini-discuss?file=${encodedPath})\n\n`;
        }

        // Add link to image if not already in note
        const noteContent = await this.app.vault.read(noteFile);
        if (!noteContent.includes(`[[${imageFile.path}]]`) && !noteContent.includes(`![[${imageFile.path}]]`)) {
            insertText += `![[${imageFile.path}]]\n\n`;
        }

        insertText += `---\n### Processed from ${imageFile.name}\n${resultText}\n---`;

        editor.replaceRange(insertText, { line: cursor.line, ch: lineContent.length });

        // Update note properties
        await this.updateNoteProperties(imageFile, noteFile, detectedTags, locationTag, null, null);
    }

    // Modal for choosing processing method
    async showImageProcessingChoiceModal(file: TFile): Promise<'new' | 'current' | null> {
        return new Promise((resolve) => {
            const modal = new Modal(this.app);
            modal.titleEl.setText(`Process ${file.name}`);

            const content = modal.contentEl;
            content.style.cssText = 'text-align: center; padding: 20px;';

            content.createEl('p', {
                text: 'How would you like to process this image?',
                cls: 'setting-item-description'
            });

            const buttonContainer = content.createDiv();
            buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: center; margin-top: 20px;';

            const currentNoteBtn = buttonContainer.createEl('button', {
                text: '📝 Insert in Current Note',
                cls: 'mod-cta'
            });

            const newNoteBtn = buttonContainer.createEl('button', {
                text: '📄 Create New Note'
            });

            const cancelBtn = buttonContainer.createEl('button', {
                text: 'Cancel'
            });

            currentNoteBtn.onclick = () => {
                modal.close();
                resolve('current');
            };

            newNoteBtn.onclick = () => {
                modal.close();
                resolve('new');
            };

            cancelBtn.onclick = () => {
                modal.close();
                resolve(null);
            };

            modal.open();
        });
    }

    // Batch processing modal
    async showBatchProcessModal() {
        const modal = new Modal(this.app);
        modal.titleEl.setText('Batch Process Images');

        const content = modal.contentEl;
        content.style.cssText = 'padding: 20px;';

        content.createEl('h3', { text: 'Select Folder' });
        content.createEl('p', {
            text: 'Choose a folder containing images to process',
            cls: 'setting-item-description'
        });

        // Get all folders - FIXED VERSION
        const folders: string[] = [];
        const rootFolder = this.app.vault.getRoot();
        const getAllFolders = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    folders.push(child.path);
                    getAllFolders(child);
                }
            }
        };
        if (rootFolder instanceof TFolder) {
            folders.push('/'); // Add root
            getAllFolders(rootFolder);
        }
        folders.sort();

        const folderSelect = content.createEl('select', { cls: 'dropdown' });
        folderSelect.style.cssText = 'width: 100%; margin-bottom: 20px;';

        folderSelect.createEl('option', { value: '', text: '-- Select a folder --' });
        folders.forEach((folder: string) => {  // FIXED: Added type annotation
            folderSelect.createEl('option', { value: folder, text: folder || '/' });
        });

        // Options
        const optionsContainer = content.createDiv();

        const createNotesCheckbox = optionsContainer.createEl('input', {
            type: 'checkbox',
            attr: { id: 'create-notes' }
        });
        createNotesCheckbox.checked = true;

        const createNotesLabel = optionsContainer.createEl('label', {
            text: ' Create separate notes for each image',
            attr: { for: 'create-notes' }
        });
        createNotesLabel.style.marginLeft = '5px';

        // Notebook selection (optional)
        const notebookContainer = content.createDiv();
        notebookContainer.style.cssText = 'margin-top: 20px;';

        const useNotebookCheckbox = notebookContainer.createEl('input', {
            type: 'checkbox',
            attr: { id: 'use-notebook' }
        });

        const useNotebookLabel = notebookContainer.createEl('label', {
            text: ' Assign to notebook',
            attr: { for: 'use-notebook' }
        });
        useNotebookLabel.style.marginLeft = '5px';

        const notebookSelect = notebookContainer.createEl('select', { cls: 'dropdown' });
        notebookSelect.style.cssText = 'margin-left: 10px; display: none;';

        this.settings.notebooks.forEach(notebook => {
            notebookSelect.createEl('option', {
                value: notebook.id,
                text: notebook.name
            });
        });

        useNotebookCheckbox.onchange = () => {
            notebookSelect.style.display = useNotebookCheckbox.checked ? 'inline' : 'none';
        };

        // Buttons
        const buttonContainer = content.createDiv();
        buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;';

        const processBtn = buttonContainer.createEl('button', {
            text: 'Process Images',
            cls: 'mod-cta'
        });

        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel'
        });

        processBtn.onclick = async () => {
            const selectedFolder = folderSelect.value;
            if (!selectedFolder) {
                new Notice('Please select a folder');
                return;
            }

            modal.close();

            const folder = this.app.vault.getAbstractFileByPath(selectedFolder);
            if (!(folder instanceof TFolder)) {
                new Notice('Invalid folder selected');
                return;
            }

            // Get all images in folder
            const images = folder.children.filter(file =>
                file instanceof TFile &&
                file.extension.match(/^(png|jpg|jpeg|gif)$/i)
            ) as TFile[];

            if (images.length === 0) {
                new Notice('No images found in selected folder');
                return;
            }

            const notebook = useNotebookCheckbox.checked ?
                this.settings.notebooks.find(n => n.id === notebookSelect.value) : null;

            let startingPage = notebook?.currentPage || 1;

            const progressNotice = new Notice(`Processing ${images.length} images...`, 0);

            for (let i = 0; i < images.length; i++) {
                progressNotice.setMessage(`Processing ${i + 1}/${images.length}: ${images[i].name}`);

                try {
                    await this.processExistingImage(images[i], {
                        createNewNote: createNotesCheckbox.checked,
                        insertInCurrentNote: false,
                        notebook: notebook,
                        pageNumber: notebook ? startingPage + i : null
                    });

                    // Small delay between processing
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error(`Failed to process ${images[i].name}:`, error);
                }
            }

            if (notebook) {
                notebook.currentPage = startingPage + images.length;
                await this.saveSettings();
            }

            progressNotice.hide();
            new Notice(`Processed ${images.length} images successfully!`);
        };

        cancelBtn.onclick = () => modal.close();

        modal.open();
    }

    async discussWithGemini(noteContent: string, userPrompt: string): Promise<string> {
        const apiKey = this.settings.geminiApiKey;
        const model = this.settings.selectedModel;
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const prompt = `You are having a discussion about a note that was previously processed. Here is the note content:

---
${noteContent}
---

The user has a follow-up question or request:
"${userPrompt}"

Please provide a helpful, detailed, and thoughtful response based on the note content and their question. If appropriate, suggest related topics to explore, provide examples, or offer actionable insights.`;

        const requestBody = {
            contents: [{
                parts: [{ text: prompt }]
            }]
        };

        try {
            const response = await requestUrl({
                url: API_URL,
                method: 'POST',
                contentType: 'application/json',
                body: JSON.stringify(requestBody)
            });

            if (response.json.candidates?.[0]?.content?.parts?.[0]?.text) {
                return response.json.candidates[0].content.parts[0].text;
            } else {
                throw new Error('No valid response from Gemini');
            }
        } catch (error) {
            console.error('Gemini discussion failed:', error);
            throw error;
        }
    }

    async appendToDiscussionFile(discussionPath: string, question: string, response: string, sourceFile: TFile) {
        let discussionFile = this.app.vault.getAbstractFileByPath(discussionPath);
        const timestamp = window.moment().format('YYYY-MM-DD HH:mm');

        if (discussionFile instanceof TFile) {
            // Append to existing discussion
            const existingContent = await this.app.vault.read(discussionFile);
            const newEntry = `

---

## Discussion Entry - ${timestamp}

**Question:** ${question}

**Gemini's Response:**
${response}`;

            const updatedContent = existingContent + newEntry;
            await this.app.vault.modify(discussionFile, updatedContent);

        } else {
            // Create new discussion note
            const discussionContent = `# Discussion: [[${sourceFile.basename}]]

## Discussion Entry - ${timestamp}

**Question:** ${question}

**Gemini's Response:**
${response}

---
*Source note: [[${sourceFile.basename}]]*
*Created: ${timestamp}*`;

            await this.app.vault.create(discussionPath, discussionContent);
        }
    }

    async getNotebookFolder(notebookId: string): Promise<string> {
        const notebook = this.settings.notebooks.find(n => n.id === notebookId);
        if (!notebook) return this.settings.newNoteLocation;

        let folderPath = this.settings.notebookFolderPattern;
        folderPath = folderPath.replace('{notebook}', notebook.name.replace(/[\\/:*?"<>|]/g, '-'));
        folderPath = folderPath.replace(/YYYY/g, window.moment().format("YYYY"));
        folderPath = folderPath.replace(/MM/g, window.moment().format("MM"));
        folderPath = folderPath.replace(/DD/g, window.moment().format("DD"));

        return folderPath;
    }

    createNotebook(): Notebook {
        return {
            id: Date.now().toString(),
            name: `Notebook ${this.settings.notebooks.length + 1}`,
            startDate: new Date().toISOString(),
            currentPage: 1,
            status: 'active',
            description: ''
        };
    }

    async showNotebookSelectionModal(): Promise<{ notebook: Notebook | null, pageNumber: number | null, cancelled: boolean }> {
        if (this.settings.notebooks.length === 0) {
            new Notice("No notebooks found. Creating a default notebook...");
            const defaultNotebook = this.createNotebook();
            defaultNotebook.name = "My Notebook";
            this.settings.notebooks.push(defaultNotebook);
            await this.saveSettings();
        }

        return new Promise((resolve) => {
            const modal = new Modal(this.app);
            modal.titleEl.setText('Select Notebook & Page');

            // Make modal larger for visual browser
            modal.modalEl.style.cssText = `
                width: 90vw;
                max-width: 1200px;
                height: 80vh;
                max-height: 800px;
            `;

            let selectedNotebook: Notebook | null = null;
            let pageNumber: number | null = null;

            const formContainer = modal.contentEl.createDiv();
            formContainer.style.cssText = 'display: flex; flex-direction: column; height: 100%;';

            // Top section: Notebook selector
            const headerSection = formContainer.createDiv({ cls: 'notebook-header' });
            headerSection.style.cssText = 'padding: 15px; border-bottom: 1px solid var(--background-modifier-border); flex-shrink: 0;';

            headerSection.createEl('h3', { text: 'Choose Notebook' });

            const notebookContainer = headerSection.createDiv({ cls: 'setting-item' });
            notebookContainer.style.cssText = 'display: flex; align-items: center; gap: 15px;';

            notebookContainer.createEl('label', { text: 'Notebook:' });
            const notebookSelect = notebookContainer.createEl('select', { cls: 'dropdown' });
            notebookSelect.style.cssText = 'flex: 1; max-width: 300px;';

            notebookSelect.createEl('option', {
                value: '',
                text: '📄 Loose paper / No notebook'
            });

            const activeNotebooks = this.settings.notebooks.filter(n => n.status === 'active');
            if (activeNotebooks.length > 0) {
                const activeGroup = notebookSelect.createEl('optgroup', { attr: { label: 'Active Notebooks' } });
                activeNotebooks.forEach(notebook => {
                    activeGroup.createEl('option', {
                        value: notebook.id,
                        text: `📓 ${notebook.name} (${notebook.currentPage} pages)`
                    });
                });
            }

            const completedNotebooks = this.settings.notebooks.filter(n => n.status === 'completed');
            if (completedNotebooks.length > 0) {
                const completedGroup = notebookSelect.createEl('optgroup', { attr: { label: 'Completed Notebooks' } });
                completedNotebooks.forEach(notebook => {
                    completedGroup.createEl('option', {
                        value: notebook.id,
                        text: `📕 ${notebook.name} (Completed)`
                    });
                });
            }

            // Page number input for new pages
            const newPageContainer = notebookContainer.createDiv({ cls: 'new-page-input' });
            newPageContainer.style.cssText = 'display: flex; align-items: center; gap: 10px;';
            newPageContainer.createEl('label', { text: 'New page #:' });
            const pageInput = newPageContainer.createEl('input', {
                type: 'number',
                attr: {
                    min: '1',
                    placeholder: 'Page number'
                }
            });
            pageInput.style.cssText = 'width: 100px;';

            // Visual page browser section
            const browserSection = formContainer.createDiv({ cls: 'page-browser' });
            browserSection.style.cssText = 'flex: 1; overflow-y: auto; padding: 15px; background: var(--background-secondary);';

            const browserHeader = browserSection.createDiv();
            browserHeader.style.cssText = 'margin-bottom: 15px;';
            const browserTitle = browserHeader.createEl('h4', { text: 'Recent Pages' });
            const pageCount = browserHeader.createEl('span', {
                cls: 'setting-item-description',
                text: ' - Select a page or enter a new page number above'
            });

            // Grid container for page thumbnails
            const pageGrid = browserSection.createDiv({ cls: 'page-grid' });
            pageGrid.style.cssText = `
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                gap: 15px;
                padding: 10px;
            `;

            // Function to load pages for a notebook
            const loadNotebookPages = async (notebookId: string) => {
                pageGrid.empty();

                if (!notebookId) {
                    // Show recent loose pages
                    browserTitle.setText('Recent Loose Pages');
                    await loadLoosePages();
                    return;
                }

                const notebook = this.settings.notebooks.find(n => n.id === notebookId);
                if (!notebook) return;

                selectedNotebook = notebook;
                browserTitle.setText(`Pages from ${notebook.name}`);
                pageInput.value = notebook.currentPage.toString();
                pageNumber = notebook.currentPage;

                // Find all notes with this notebook ID
                const allFiles = this.app.vault.getMarkdownFiles();
                const notebookPages: Array<{ file: TFile, page: number, image?: string }> = [];

                for (const file of allFiles) {
                    const cache = this.app.metadataCache.getFileCache(file);
                    if (cache?.frontmatter?.notebook_id === notebookId) {
                        const pageNum = cache.frontmatter.page || 0;
                        const imageName = cache.frontmatter.image;
                        notebookPages.push({ file, page: pageNum, image: imageName });
                    }
                }

                // Sort by page number
                notebookPages.sort((a, b) => b.page - a.page);

                pageCount.setText(` - ${notebookPages.length} pages found`);

                // Create "Add New Page" card first
                const newPageCard = pageGrid.createDiv({ cls: 'page-card new-page' });
                newPageCard.style.cssText = `
                    border: 2px dashed var(--interactive-accent);
                    border-radius: 8px;
                    padding: 20px;
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    min-height: 250px;
                    background: var(--background-primary);
                    transition: all 0.2s ease;
                `;

                newPageCard.innerHTML = `
                    <div style="font-size: 48px; margin-bottom: 10px;">➕</div>
                    <div style="font-weight: bold;">Add New Page</div>
                    <div style="color: var(--text-muted); font-size: 12px; margin-top: 5px;">Page ${notebook.currentPage}</div>
                `;

                newPageCard.addEventListener('mouseenter', () => {
                    newPageCard.style.transform = 'scale(1.02)';
                    newPageCard.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
                });

                newPageCard.addEventListener('mouseleave', () => {
                    newPageCard.style.transform = 'scale(1)';
                    newPageCard.style.boxShadow = 'none';
                });

                newPageCard.addEventListener('click', () => {
                    pageNumber = notebook.currentPage;
                    pageInput.value = pageNumber.toString();
                    // Highlight selected
                    pageGrid.querySelectorAll('.page-card').forEach(card => {
                        card.removeClass('selected');
                    });
                    newPageCard.addClass('selected');
                    newPageCard.style.borderColor = 'var(--interactive-success)';
                    newPageCard.style.background = 'var(--background-modifier-hover)';
                });

                // Create cards for existing pages
                for (const pageInfo of notebookPages) {
                    const pageCard = pageGrid.createDiv({ cls: 'page-card' });
                    pageCard.style.cssText = `
                        border: 1px solid var(--background-modifier-border);
                        border-radius: 8px;
                        overflow: hidden;
                        cursor: pointer;
                        background: var(--background-primary);
                        transition: all 0.2s ease;
                        display: flex;
                        flex-direction: column;
                    `;

                    // Image preview section
                    const imagePreview = pageCard.createDiv({ cls: 'page-preview' });
                    imagePreview.style.cssText = `
                        height: 150px;
                        background: var(--background-modifier-hover);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        overflow: hidden;
                        position: relative;
                    `;

                    if (pageInfo.image) {
                        // Try to find and display the image
                        const imagePath = this.app.vault.getFiles().find(f => f.name === pageInfo.image);
                        if (imagePath) {
                            const img = imagePreview.createEl('img');
                            img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
                            img.src = this.app.vault.getResourcePath(imagePath);
                        } else {
                            imagePreview.createDiv({ text: '📄', cls: 'no-image' })
                                .style.cssText = 'font-size: 48px; opacity: 0.3;';
                        }
                    } else {
                        imagePreview.createDiv({ text: '📄', cls: 'no-image' })
                            .style.cssText = 'font-size: 48px; opacity: 0.3;';
                    }

                    // Page info section
                    const pageInfoDiv = pageCard.createDiv({ cls: 'page-info' });
                    pageInfoDiv.style.cssText = 'padding: 10px;';

                    const pageTitle = pageInfoDiv.createEl('div', {
                        text: `Page ${pageInfo.page}`,
                        cls: 'page-title'
                    });
                    pageTitle.style.cssText = 'font-weight: bold; margin-bottom: 5px;';

                    const fileName = pageInfoDiv.createEl('div', {
                        text: pageInfo.file.basename,
                        cls: 'page-filename'
                    });
                    fileName.style.cssText = 'font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

                    const fileDate = pageInfoDiv.createEl('div', {
                        text: window.moment(pageInfo.file.stat.mtime).format('MMM DD, YYYY'),
                        cls: 'page-date'
                    });
                    fileDate.style.cssText = 'font-size: 10px; color: var(--text-faint); margin-top: 3px;';

                    // Hover effect
                    pageCard.addEventListener('mouseenter', () => {
                        pageCard.style.transform = 'scale(1.02)';
                        pageCard.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
                    });

                    pageCard.addEventListener('mouseleave', () => {
                        pageCard.style.transform = 'scale(1)';
                        pageCard.style.boxShadow = 'none';
                    });

                    // Click to view note
                    pageCard.addEventListener('click', () => {
                        // Open the note in a new tab
                        this.app.workspace.getLeaf('tab').openFile(pageInfo.file);
                    });
                }
            };

            // Function to load loose pages (no notebook)
            const loadLoosePages = async () => {
                pageGrid.empty();
                newPageContainer.style.display = 'none';

                const allFiles = this.app.vault.getMarkdownFiles();
                const loosePages: TFile[] = [];

                for (const file of allFiles) {
                    const cache = this.app.metadataCache.getFileCache(file);
                    if (!cache?.frontmatter?.notebook_id) {
                        // Check if it has our custom tags to identify it as a scan
                        const tags = cache?.frontmatter?.tags || [];
                        if (tags.some((tag: string) => tag.includes('from-notebook') || tag.includes('sketchnote'))) {
                            loosePages.push(file);
                        }
                    }
                }

                // Sort by date
                loosePages.sort((a, b) => (b.stat.mtime || 0) - (a.stat.mtime || 0));

                pageCount.setText(` - ${loosePages.length} loose pages found`);

                // Create cards for loose pages
                for (const file of loosePages.slice(0, 20)) { // Limit to 20 most recent
                    const cache = this.app.metadataCache.getFileCache(file);
                    const imageName = cache?.frontmatter?.image;

                    const pageCard = pageGrid.createDiv({ cls: 'page-card' });
                    pageCard.style.cssText = `
                        border: 1px solid var(--background-modifier-border);
                        border-radius: 8px;
                        overflow: hidden;
                        cursor: pointer;
                        background: var(--background-primary);
                        transition: all 0.2s ease;
                    `;

                    const imagePreview = pageCard.createDiv({ cls: 'page-preview' });
                    imagePreview.style.cssText = `
                        height: 150px;
                        background: var(--background-modifier-hover);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    `;

                    if (imageName) {
                        const imagePath = this.app.vault.getFiles().find(f => f.name === imageName);
                        if (imagePath) {
                            const img = imagePreview.createEl('img');
                            img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
                            img.src = this.app.vault.getResourcePath(imagePath);
                        }
                    } else {
                        imagePreview.createDiv({ text: '📄' }).style.cssText = 'font-size: 48px; opacity: 0.3;';
                    }

                    const pageInfoDiv = pageCard.createDiv({ cls: 'page-info' });
                    pageInfoDiv.style.cssText = 'padding: 10px;';
                    pageInfoDiv.createEl('div', { text: file.basename })
                        .style.cssText = 'font-weight: bold; font-size: 12px; overflow: hidden; text-overflow: ellipsis;';
                    pageInfoDiv.createEl('div', { text: window.moment(file.stat.mtime).format('MMM DD, YYYY HH:mm') })
                        .style.cssText = 'font-size: 10px; color: var(--text-muted); margin-top: 5px;';

                    pageCard.addEventListener('click', () => {
                        this.app.workspace.getLeaf('tab').openFile(file);
                    });

                    pageCard.addEventListener('mouseenter', () => {
                        pageCard.style.transform = 'scale(1.02)';
                        pageCard.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
                    });

                    pageCard.addEventListener('mouseleave', () => {
                        pageCard.style.transform = 'scale(1)';
                        pageCard.style.boxShadow = 'none';
                    });
                }
            };

            // Load initial content
            if (this.settings.currentNotebookId) {
                notebookSelect.value = this.settings.currentNotebookId;
                loadNotebookPages(this.settings.currentNotebookId);
            } else {
                loadLoosePages();
            }

            // Handle notebook selection change
            notebookSelect.addEventListener('change', () => {
                const notebookId = notebookSelect.value;
                if (notebookId) {
                    newPageContainer.style.display = 'flex';
                    loadNotebookPages(notebookId);
                } else {
                    selectedNotebook = null;
                    pageNumber = null;
                    loadLoosePages();
                }
            });

            // Handle page number input
            pageInput.addEventListener('input', () => {
                const value = parseInt(pageInput.value);
                if (!isNaN(value) && value > 0) {
                    pageNumber = value;
                }
            });

            // Auto-increment checkbox
            const autoIncrementContainer = headerSection.createDiv({ cls: 'setting-item' });
            autoIncrementContainer.style.cssText = 'margin-top: 10px;';
            const autoIncrementCheckbox = autoIncrementContainer.createEl('input', {
                type: 'checkbox',
                attr: { id: 'auto-increment-check' }
            });
            autoIncrementCheckbox.checked = this.settings.autoIncrementPage;
            const autoIncrementLabel = autoIncrementContainer.createEl('label', {
                text: ' Auto-increment page number after capture',
                attr: { for: 'auto-increment-check' }
            });
            autoIncrementLabel.style.marginLeft = '5px';

            // Button container at bottom
            const buttonContainer = formContainer.createDiv({ cls: 'modal-button-container' });
            buttonContainer.style.cssText = 'padding: 15px; border-top: 1px solid var(--background-modifier-border); display: flex; justify-content: flex-end; gap: 10px;';

            const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
            cancelButton.addEventListener('click', () => {
                modal.close();
                resolve({ notebook: null, pageNumber: null, cancelled: true });
            });

            const confirmButton = buttonContainer.createEl('button', {
                text: 'Capture Image',
                cls: 'mod-cta'
            });
            confirmButton.addEventListener('click', async () => {
                if (selectedNotebook && pageNumber && autoIncrementCheckbox.checked) {
                    selectedNotebook.currentPage = pageNumber + 1;
                }
                if (selectedNotebook) {
                    this.settings.currentNotebookId = selectedNotebook.id;
                }
                await this.saveSettings();
                modal.close();
                resolve({ notebook: selectedNotebook, pageNumber: pageNumber, cancelled: false });
            });

            modal.open();
        });
    }

    async getCurrentCoords(): Promise<{ latitude: number, longitude: number } | null> {
        return new Promise((resolve) => {
            if (!navigator.geolocation) { resolve(null); return; }
            navigator.geolocation.getCurrentPosition(
                (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
                (error) => { console.error("Geolocation error:", error); resolve(null); },
                { enableHighAccuracy: false, timeout: 5000, maximumAge: 600000 }
            );
        });
    }

    async getCountryFromCoords(latitude: number, longitude: number): Promise<string | null> {
        try {
            const response = await requestUrl({
                url: `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=3&accept-language=en`,
                method: 'GET',
                headers: { 'User-Agent': 'Obsidian-Gemini-Note-Processor/1.0' }
            });
            const data = response.json;
            if (data?.address?.country) {
                return data.address.country.toLowerCase().replace(/\s+/g, '-');
            }
        } catch (error) { console.error("Reverse geocoding failed:", error); }
        return null;
    }

    async extractLocationFromImage(imageData: ArrayBuffer): Promise<string | null> {
        console.log('=== Starting EXIF Location Extraction ===');
        console.log('Image data size:', imageData.byteLength, 'bytes');

        try {
            const buffer = Buffer.from(imageData);
            console.log('Buffer created, size:', buffer.length);

            // Try to parse EXIF data
            const exifData: any = ExifReader(buffer);
            console.log('EXIF data parsed successfully');

            // Check different possible GPS data locations
            if (exifData) {
                // Check for GPS data in different possible locations
                if (exifData.gps) {
                    console.log('Found gps object:', exifData.gps);

                    // Check for different coordinate formats
                    if (exifData.gps.Latitude && exifData.gps.Longitude) {
                        console.log('GPS Latitude:', exifData.gps.Latitude);
                        console.log('GPS Longitude:', exifData.gps.Longitude);

                        const country = await this.getCountryFromCoords(exifData.gps.Latitude, exifData.gps.Longitude);
                        if (country) {
                            new Notice(`Location from photo: ${country}`);
                            return country;
                        }
                    }
                }
            }
        } catch (error: any) {
            console.error('Error parsing EXIF data:', error);
        }

        // Fallback to current location if enabled
        if (this.settings.fallbackToCurrentLocation) {
            console.log('No GPS in photo, falling back to current location...');
            const currentCoords = await this.getCurrentCoords();
            if (currentCoords) {
                console.log('Current location:', currentCoords);
                const country = await this.getCountryFromCoords(currentCoords.latitude, currentCoords.longitude);
                if (country) {
                    new Notice(`Using current location: ${country}`);
                    return country;
                }
            }
        }

        console.log('=== Location extraction completed, no location found ===');
        return null;
    }

    async processImageInCurrentNote(file: TFile) {
        if (!this.settings.geminiApiKey) { new Notice("Gemini API key is not set."); return; }
        new Notice("Processing with Gemini...");

        try {
            const imageData = await this.app.vault.readBinary(file);
            let resultText = await this.callGeminiAPI(imageData);
            if (!resultText) throw new Error("API call returned no text.");

            if (this.settings.enableTriggerWords) {
                resultText = await this.processTriggersInText(resultText);
            }

            let locationTag: string | null = null;
            if (this.settings.enableLocationTagging) {
                locationTag = await this.extractLocationFromImage(imageData);
            }

            const noteFile = this.app.workspace.getActiveFile();
            if (noteFile) {
                const detectedTags = this.parseDetectedTags(resultText);
                await this.updateNoteProperties(file, noteFile, detectedTags, locationTag, null, null);
            }

            const editor = this.app.workspace.activeEditor?.editor;
            if (resultText && editor) {
                const cursor = editor.getCursor();
                const lineContent = editor.getLine(cursor.line);

                // Build insert text with discussion link at the top
                let insertText = '\n\n';

                // Add discussion link first if enabled
                if (this.settings.enableDiscussionLinks && noteFile) {
                    const encodedPath = encodeURIComponent(noteFile.path);
                    insertText += `[${this.settings.discussionLinkText}](obsidian://gemini-discuss?file=${encodedPath})\n\n`;
                }

                // Then add the main content
                insertText += `---\n${resultText}\n---`;

                editor.replaceRange(insertText, { line: cursor.line, ch: lineContent.length });
                new Notice("Note processed successfully!");
            }
        } catch (error) {
            console.error("Error during image processing:", error);
            new Notice("Failed to process image. Check console.");
        }
    }

    async captureFromAndroidCamera(): Promise<ArrayBuffer | null> {
        // Check if this is the first camera attempt to show mode selection
        if (this.settings.androidCameraMode === 'ask') {
            const choice = await this.showAndroidCameraModeModal();
            if (!choice) return null;
            this.settings.androidCameraMode = choice;
            await this.saveSettings();
        }

        // If gallery mode is selected, return null to trigger file picker
        if (this.settings.androidCameraMode === 'gallery') {
            return null;
        }

        return new Promise((resolve) => {
            const modal = new Modal(this.app);
            modal.titleEl.setText('Camera Capture');

            const videoContainer = modal.contentEl.createDiv({ cls: 'camera-container' });
            videoContainer.style.cssText = 'position: relative; width: 100%; max-width: 500px; margin: 0 auto;';

            const video = videoContainer.createEl('video', {
                attr: { autoplay: true, playsinline: true },
                cls: 'camera-video'
            });
            video.style.cssText = 'width: 100%; height: auto; border-radius: 8px;';

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            const buttonContainer = modal.contentEl.createDiv({ cls: 'camera-buttons' });
            buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: center; margin-top: 15px;';

            const captureBtn = buttonContainer.createEl('button', {
                text: '📸 Capture',
                cls: 'mod-cta'
            });
            captureBtn.disabled = true;

            const galleryBtn = buttonContainer.createEl('button', {
                text: '🖼️ Use Gallery Instead'
            });

            const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });

            let stream: MediaStream | null = null;

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                videoContainer.style.display = 'none';
                captureBtn.style.display = 'none';
                const errorDiv = modal.contentEl.createDiv({ cls: 'camera-error' });
                errorDiv.style.cssText = 'padding: 20px; text-align: center;';
                errorDiv.innerHTML = `
                    <h3>Camera Not Available</h3>
                    <p>Direct camera access is not supported in this version of Obsidian.</p>
                    <p>Click "Use Gallery Instead" to select a photo from your device.</p>
                `;
                modal.open();

                galleryBtn.onclick = () => {
                    modal.close();
                    resolve(null); // This will trigger the file picker fallback
                };

                cancelBtn.onclick = () => {
                    modal.close();
                    resolve(null);
                };
                return;
            }

            navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            })
                .then((mediaStream) => {
                    stream = mediaStream;
                    video.srcObject = stream;
                    captureBtn.disabled = false;
                    galleryBtn.style.display = 'none'; // Hide gallery button if camera works
                })
                .catch((err) => {
                    console.error('Camera access failed:', err);
                    videoContainer.style.display = 'none';
                    captureBtn.style.display = 'none';

                    const errorDiv = modal.contentEl.createDiv({ cls: 'camera-error' });
                    errorDiv.style.cssText = 'padding: 20px; text-align: center;';

                    let errorMessage = `<h3>Camera Access Issue</h3>`;

                    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                        errorMessage += `
                            <div style="background: var(--background-modifier-error-hover); padding: 15px; border-radius: 8px; margin: 15px 0;">
                                <p><strong>⚠️ Known Android Limitation</strong></p>
                                <p>Obsidian on Android may not have camera permission available.</p>
                            </div>
                            <p><strong>Recommended Solution:</strong></p>
                            <p>Use "Gallery" mode to take photos with your camera app, then select them.</p>
                            <div style="margin-top: 20px;">
                                <button class="mod-cta" id="switch-to-gallery">Switch to Gallery Mode</button>
                            </div>`;
                    } else {
                        errorMessage += `<p>Camera error: ${err.message || err.name}</p>
                                <p>Try using Gallery mode instead.</p>`;
                    }
                    errorDiv.innerHTML = errorMessage;

                    // Add event listener for the switch to gallery button if it exists
                    setTimeout(() => {
                        const switchBtn = modal.contentEl.querySelector('#switch-to-gallery');
                        if (switchBtn) {
                            switchBtn.addEventListener('click', async () => {
                                this.settings.androidCameraMode = 'gallery';
                                await this.saveSettings();
                                modal.close();
                                resolve(null); // Trigger gallery fallback
                            });
                        }
                    }, 0);
                });

            captureBtn.onclick = async () => {
                if (!ctx || !stream) return;
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0);
                canvas.toBlob(async (blob) => {
                    if (blob) {
                        const arrayBuffer = await blob.arrayBuffer();
                        stream?.getTracks().forEach(track => track.stop());
                        modal.close();
                        resolve(arrayBuffer);
                    } else { resolve(null); }
                }, 'image/jpeg', 0.9);
            };

            galleryBtn.onclick = () => {
                stream?.getTracks().forEach(track => track.stop());
                modal.close();
                resolve(null); // This will trigger the file picker fallback
            };

            cancelBtn.onclick = () => {
                stream?.getTracks().forEach(track => track.stop());
                modal.close();
                resolve(null);
            };

            modal.onClose = () => {
                stream?.getTracks().forEach(track => track.stop());
            };

            modal.open();
        });
    }

    async showAndroidCameraModeModal(): Promise<'camera' | 'gallery' | null> {
        return new Promise((resolve) => {
            const modal = new Modal(this.app);
            modal.titleEl.setText('Choose Capture Method');

            const content = modal.contentEl;
            content.style.cssText = 'text-align: center;';

            content.createEl('p', {
                text: 'How would you like to capture images on Android?',
                cls: 'setting-item-description'
            });

            const optionsContainer = content.createDiv();
            optionsContainer.style.cssText = 'margin: 20px 0;';

            const cameraOption = optionsContainer.createDiv({ cls: 'capture-option' });
            cameraOption.style.cssText = 'padding: 15px; margin: 10px; border: 1px solid var(--background-modifier-border); border-radius: 8px; cursor: pointer;';
            cameraOption.innerHTML = `
                <h4>📸 Direct Camera</h4>
                <p style="font-size: 0.9em; opacity: 0.8;">Try to use camera directly in Obsidian</p>
                <p style="font-size: 0.8em; color: var(--text-warning);">⚠️ May not work on all Android devices</p>
            `;

            const galleryOption = optionsContainer.createDiv({ cls: 'capture-option' });
            galleryOption.style.cssText = 'padding: 15px; margin: 10px; border: 2px solid var(--interactive-accent); border-radius: 8px; cursor: pointer; background: var(--background-modifier-hover);';
            galleryOption.innerHTML = `
                <h4>🖼️ Gallery (Recommended)</h4>
                <p style="font-size: 0.9em; opacity: 0.8;">Use your camera app, then select the photo</p>
                <p style="font-size: 0.8em; color: var(--text-success);">✓ Works on all devices</p>
            `;

            cameraOption.onclick = () => {
                modal.close();
                resolve('camera');
            };

            galleryOption.onclick = () => {
                modal.close();
                resolve('gallery');
            };

            const cancelBtn = content.createEl('button', { text: 'Cancel' });
            cancelBtn.style.cssText = 'margin-top: 10px;';
            cancelBtn.onclick = () => {
                modal.close();
                resolve(null);
            };

            modal.open();
        });
    }

    async createNoteFromImageCapture() {
        if (!this.settings.geminiApiKey) {
            new Notice("Gemini API key is not set.");
            return;
        }

        const { notebook: selectedNotebook, pageNumber: initialPageNumber, cancelled } = await this.showNotebookSelectionModal();
        if (cancelled) {
            return;
        }

        // Start multi-page capture session
        await this.startMultiPageCapture(selectedNotebook, initialPageNumber);
    }

    async startMultiPageCapture(selectedNotebook: Notebook | null, startingPageNumber: number | null) {
        let currentPageNumber = startingPageNumber;
        let pagesProcessed = 0;
        let continueCapturing = true;

        // Detect platform once
        const userAgent = navigator.userAgent;
        const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
        const isAndroid = /Android/i.test(userAgent);

        while (continueCapturing) {
            // Show current page info
            const pageInfo = selectedNotebook && currentPageNumber
                ? `Page ${currentPageNumber} of ${selectedNotebook.name}`
                : 'Loose page';

            new Notice(`Capturing: ${pageInfo}`);

            let imageData: ArrayBuffer | null = null;
            let sourceFileName = 'captured-image.jpg';

            // Capture logic (same as before)
            if (isAndroid && this.settings.androidCameraMode !== 'gallery') {
                imageData = await this.captureFromAndroidCamera();
                if (!imageData && this.settings.androidCameraMode === 'camera') {
                    new Notice("Camera access failed. Falling back to gallery...");
                }
            }

            // Single or multi-file selection
            if (!imageData) {
                const result = await this.selectImageFiles(isIOS, isAndroid);

                if (result.files && result.files.length > 0) {
                    // Process multiple files if selected
                    if (result.files.length > 1) {
                        await this.processBatchImages(
                            result.files,
                            selectedNotebook,
                            currentPageNumber
                        );

                        // Update page number based on files processed
                        if (selectedNotebook && currentPageNumber) {
                            currentPageNumber += result.files.length;
                            selectedNotebook.currentPage = currentPageNumber;
                            await this.saveSettings();
                        }

                        pagesProcessed += result.files.length;
                        continueCapturing = false; // End after batch processing
                        continue;
                    } else {
                        // Single file
                        imageData = await result.files[0].arrayBuffer();
                        sourceFileName = result.files[0].name;
                    }
                }
            }

            if (!imageData) {
                console.log("No image data received, ending capture session.");
                break;
            }

            // Process the single captured image
            await this.processCapturedImage(imageData, sourceFileName, selectedNotebook, currentPageNumber);
            pagesProcessed++;

            // Update page number for next capture
            if (selectedNotebook && currentPageNumber && this.settings.autoIncrementPage) {
                currentPageNumber++;
                selectedNotebook.currentPage = currentPageNumber;
                await this.saveSettings();
            }

            // Ask if user wants to continue
            continueCapturing = await this.askToContinueCapture(pagesProcessed, selectedNotebook);
        }

        // Final summary
        if (pagesProcessed > 0) {
            new Notice(`✅ Successfully processed ${pagesProcessed} page${pagesProcessed > 1 ? 's' : ''}`);
        }
    }

    async selectImageFiles(isIOS: boolean, isAndroid: boolean): Promise<{ files: File[] }> {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';

            // Enable multiple file selection
            input.multiple = true;

            // For iOS devices, still enable camera capture for single photos
            if (isIOS) {
                input.capture = 'environment';
            } else if (isAndroid && this.settings.androidCameraMode === 'camera') {
                input.capture = 'environment';
            }

            input.style.display = 'none';
            document.body.appendChild(input);

            input.onchange = () => {
                const files = input.files ? Array.from(input.files) : [];
                document.body.removeChild(input);

                // Sort files by name to maintain order
                files.sort((a, b) => a.name.localeCompare(b.name));

                if (files.length > 1) {
                    new Notice(`Selected ${files.length} images for batch processing`);
                }

                resolve({ files });
            };

            input.addEventListener('cancel', () => {
                document.body.removeChild(input);
                resolve({ files: [] });
            });

            input.click();
        });
    }

    async processBatchImages(
        files: File[],
        selectedNotebook: Notebook | null,
        startingPageNumber: number | null
    ) {
        const progressNotice = new Notice(`Processing ${files.length} images...`, 0);
        let currentPageNumber = startingPageNumber;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            progressNotice.setMessage(`Processing image ${i + 1} of ${files.length}: ${file.name}`);

            try {
                const imageData = await file.arrayBuffer();
                await this.processCapturedImage(
                    imageData,
                    file.name,
                    selectedNotebook,
                    currentPageNumber
                );

                // Increment page number for next image
                if (selectedNotebook && currentPageNumber) {
                    currentPageNumber++;
                }

                // Small delay between processing to avoid overwhelming the API
                if (i < files.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                console.error(`Error processing ${file.name}:`, error);
                new Notice(`Failed to process ${file.name}. Continuing with next image...`);
            }
        }

        progressNotice.hide();
    }

    async askToContinueCapture(pagesProcessed: number, notebook: Notebook | null): Promise<boolean> {
        return new Promise((resolve) => {
            const modal = new Modal(this.app);
            modal.titleEl.setText('Continue Capturing?');

            const content = modal.contentEl;
            content.style.cssText = 'text-align: center; padding: 20px;';

            // Show progress
            const progressDiv = content.createDiv();
            progressDiv.style.cssText = 'margin-bottom: 20px;';
            progressDiv.innerHTML = `
                <div style="font-size: 24px; margin-bottom: 10px;">📸</div>
                <h3>${pagesProcessed} page${pagesProcessed > 1 ? 's' : ''} captured</h3>
                ${notebook ? `<p>Notebook: ${notebook.name}</p>` : '<p>Loose pages</p>'}
            `;

            content.createEl('p', {
                text: 'Would you like to add another page?',
                cls: 'setting-item-description'
            });

            const buttonContainer = content.createDiv();
            buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: center; margin-top: 20px;';

            // Continue button (primary)
            const continueBtn = buttonContainer.createEl('button', {
                text: '📸 Add Another Page',
                cls: 'mod-cta'
            });
            continueBtn.style.cssText = 'flex: 1;';

            // Done button
            const doneBtn = buttonContainer.createEl('button', {
                text: '✅ Done'
            });
            doneBtn.style.cssText = 'flex: 1;';

            // Quick batch options
            const batchDiv = content.createDiv();
            batchDiv.style.cssText = 'margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--background-modifier-border);';
            batchDiv.createEl('p', {
                text: '💡 Tip: You can select multiple images at once from your gallery',
                cls: 'setting-item-description'
            });

            continueBtn.onclick = () => {
                modal.close();
                resolve(true);
            };

            doneBtn.onclick = () => {
                modal.close();
                resolve(false);
            };

            // Allow Enter key to continue quickly
            modal.scope.register([], 'Enter', () => {
                modal.close();
                resolve(true);
            });

            // Allow Escape to finish
            modal.scope.register([], 'Escape', () => {
                modal.close();
                resolve(false);
            });

            modal.open();

            // Focus the continue button for quick keyboard navigation
            setTimeout(() => continueBtn.focus(), 100);
        });
    }

    async processCapturedImage(
        imageData: ArrayBuffer,
        sourceFileName: string,
        selectedNotebook: Notebook | null,
        pageNumber: number | null,
        isBatchMode: boolean = false
    ) {
        const quietMode = isBatchMode; // Less noisy in batch mode

        if (!quietMode) {
            new Notice("Uploading and processing image...");
        }

        try {
            let noteFolder = "";
            if (selectedNotebook && this.settings.groupByNotebook) {
                noteFolder = await this.getAndEnsureFolder(await this.getNotebookFolder(selectedNotebook.id));
            } else {
                noteFolder = await this.getAndEnsureFolder(this.settings.newNoteLocation);
            }

            const attachmentFolder = await this.getAndEnsureFolder(this.settings.attachmentLocation);

            const extension = sourceFileName.split('.').pop()?.toLowerCase() || 'jpg';
            const imageFileName = `GeminiCapture-${Date.now()}.${extension}`;
            const imageFilePath = `${attachmentFolder}/${imageFileName}`;
            const imageFile = await this.app.vault.createBinary(imageFilePath, imageData);

            let resultText = await this.callGeminiAPI(imageData);
            if (!resultText) throw new Error("API call returned no text.");

            if (this.settings.enableTriggerWords) {
                resultText = await this.processTriggersInText(resultText);
            }

            const detectedTags = this.parseDetectedTags(resultText);

            let locationTag: string | null = null;
            if (this.settings.enableLocationTagging) {
                locationTag = await this.extractLocationFromImage(imageData);
            }

            const timestamp = window.moment().format('YYYY-MM-DD HH-mm-ss');

            let noteFileName: string;
            if (selectedNotebook && pageNumber) {
                noteFileName = `Page ${pageNumber} - ${timestamp}.md`;
            } else {
                noteFileName = `Note ${timestamp}.md`;
            }

            const noteFilePath = noteFolder ? `${noteFolder}/${noteFileName}` : noteFileName;

            // Build note content
            let noteContent = '';

            if (this.settings.enableDiscussionLinks) {
                const encodedPath = encodeURIComponent(noteFilePath);
                noteContent += `[${this.settings.discussionLinkText}](obsidian://gemini-discuss?file=${encodedPath})\n\n`;
            }

            noteContent += `![[${imageFile.path}]]\n`;

            if (selectedNotebook && pageNumber) {
                noteContent += `\n> **Notebook:** ${selectedNotebook.name} | **Page:** ${pageNumber}\n`;
            } else if (!selectedNotebook) {
                noteContent += `\n> **Source:** Loose paper / No notebook\n`;
            }

            noteContent += `\n---\n${resultText}\n---`;

            const newNoteFile = await this.app.vault.create(noteFilePath, noteContent);
            await this.updateNoteProperties(imageFile, newNoteFile, detectedTags, locationTag, selectedNotebook?.id || null, pageNumber);

            if (!quietMode) {
                this.app.workspace.openLinkText(newNoteFile.path, '', true);
                new Notice("New note created successfully!");
            }

        } catch (error) {
            console.error("Error creating note from image:", error);
            if (!quietMode) {
                new Notice("Failed to create note. See console.");
            }
            throw error; // Re-throw for batch processing to handle
        }
    }

    async findRelatedNotesByTags(tags: string[]): Promise<string> {
        if (!tags || tags.length === 0) return 'No tags found to search for related notes.';

        const allFiles = this.app.vault.getMarkdownFiles();
        const currentFile = this.app.workspace.getActiveFile();
        const relatedNotes: Map<string, { file: TFile, matchedTags: string[], matchCount: number }> = new Map();

        for (const file of allFiles) {
            // Skip the current file
            if (currentFile && file.path === currentFile.path) continue;

            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache?.frontmatter?.tags) continue;

            const fileTags = Array.isArray(cache.frontmatter.tags)
                ? cache.frontmatter.tags
                : [cache.frontmatter.tags];

            const matchedTags = tags.filter(tag => fileTags.includes(tag));

            if (matchedTags.length > 0) {
                relatedNotes.set(file.path, {
                    file,
                    matchedTags,
                    matchCount: matchedTags.length
                });
            }
        }

        if (relatedNotes.size === 0) {
            return 'No related notes found with matching tags.';
        }

        // Sort by match count (most matches first)
        const sortedNotes = Array.from(relatedNotes.values())
            .sort((a, b) => b.matchCount - a.matchCount)
            .slice(0, 10); // Limit to top 10 related notes

        let result = `### Related Notes by Tags\n\n`;
        result += `Found ${relatedNotes.size} related notes. Showing top ${Math.min(10, relatedNotes.size)}:\n\n`;

        for (const note of sortedNotes) {
            const link = `[[${note.file.basename}]]`;
            const tagList = note.matchedTags.map(t => `#${t}`).join(', ');
            result += `- ${link} (${note.matchCount} matching tags: ${tagList})\n`;
        }

        return result;
    }

    async processTriggersInText(text: string): Promise<string> {
        const triggers = this.detectTriggerWords(text);
        let processedTasks = false;

        console.log(`Found ${triggers.length} triggers in text`);

        // Check if we have a Tasks trigger
        const tasksTrigger = triggers.find(t => t.action.keyword === 'Tasks');
        if (tasksTrigger && this.settings.enableTasksIntegration) {
            console.log('Tasks trigger found with content:', tasksTrigger.content);
            const tasksAdded = await this.addTasksToTasksNote(tasksTrigger.content);
            if (tasksAdded > 0) {
                processedTasks = true;
                new Notice(`Added ${tasksAdded} tasks to ${this.settings.tasksNotePath}`);
            } else {
                console.log('No tasks were added (returned 0)');
            }
        }

        if (triggers.length === 0) return text;

        const triggerResponses: string[] = [];
        for (const trigger of triggers) {
            // Skip Tasks trigger if we already processed it for Obsidian Tasks
            if (trigger.action.keyword === 'Tasks' && processedTasks) {
                triggerResponses.push(`### Tasks\n✅ ${trigger.content.split('\n').filter(t => t.trim()).length} tasks added to [[${this.settings.tasksNotePath.replace('.md', '')}]]`);
                continue;
            }

            // Handle TagLinks/Related trigger specially
            if (trigger.action.action === 'taglinks' || trigger.action.action === 'related') {
                new Notice(`Finding related notes by tags...`);
                const detectedTags = this.parseDetectedTags(text);
                const relatedNotes = await this.findRelatedNotesByTags(detectedTags);
                triggerResponses.push(relatedNotes);
                continue;
            }

            new Notice(`Processing trigger: ${trigger.trigger}...`);
            const response = await this.processTriggerWithGemini(trigger);
            if (response) triggerResponses.push(response);
        }

        if (triggerResponses.length > 0) {
            return `${text}\n\n---\n## Triggered Actions\n\n${triggerResponses.join('\n\n')}`;
        }
        return text;
    }

    async addTasksToTasksNote(tasksContent: string): Promise<number> {
        try {
            // Parse the tasks from the content
            const tasks = this.parseTasksForObsidianTasks(tasksContent);
            if (tasks.length === 0) {
                console.log('No tasks parsed from content');
                return 0;
            }

            console.log(`Parsed ${tasks.length} tasks:`, tasks);

            // Ensure the tasks note exists
            let tasksFile = this.app.vault.getAbstractFileByPath(this.settings.tasksNotePath);
            if (!tasksFile) {
                console.log(`Tasks file not found at ${this.settings.tasksNotePath}, creating...`);
                // Create the tasks file if it doesn't exist
                const folderPath = this.settings.tasksNotePath.substring(0, this.settings.tasksNotePath.lastIndexOf('/'));
                if (folderPath && !(await this.app.vault.adapter.exists(folderPath))) {
                    console.log(`Creating folder: ${folderPath}`);
                    await this.app.vault.createFolder(folderPath);
                }
                const initialContent = `# Tasks\n\n${this.settings.tasksSectionHeading}\n`;
                console.log(`Creating tasks file with initial content`);
                tasksFile = await this.app.vault.create(this.settings.tasksNotePath, initialContent);
            }

            if (!(tasksFile instanceof TFile)) {
                console.error('Tasks file is not a TFile instance');
                return 0;
            }

            // Read current content
            let content = await this.app.vault.read(tasksFile);
            console.log('Current tasks file content length:', content.length);

            // Find or create the section for captured tasks
            const sectionRegex = new RegExp(`^${this.settings.tasksSectionHeading}`, 'gm');
            const sectionMatch = content.match(sectionRegex);

            // Format tasks with Obsidian Tasks syntax
            const formattedTasks = tasks.map(task => this.formatTaskForObsidianTasks(task)).join('\n');
            const dateStamp = window.moment().format('YYYY-MM-DD HH:mm');
            const tasksBlock = `\n### Captured ${dateStamp}\n\n${formattedTasks}\n`;

            console.log('Tasks block to add:', tasksBlock);

            if (sectionMatch) {
                // Insert after the section heading
                const insertIndex = content.indexOf(sectionMatch[0]) + sectionMatch[0].length;
                content = content.slice(0, insertIndex) + tasksBlock + content.slice(insertIndex);
            } else {
                // Add the section at the end
                content += `\n\n${this.settings.tasksSectionHeading}${tasksBlock}`;
            }

            // Write back to file
            console.log('Writing updated content to tasks file...');
            await this.app.vault.modify(tasksFile, content);
            console.log(`Successfully added ${tasks.length} tasks to ${this.settings.tasksNotePath}`);

            return tasks.length;
        } catch (error) {
            console.error('Error adding tasks to tasks note:', error);
            new Notice(`Error adding tasks: ${error.message}`);
            return 0;
        }
    }

    parseTasksForObsidianTasks(content: string): Array<{ text: string, priority: string, tags: string[], dates?: { [key: string]: string } }> {
        const tasks: Array<{ text: string, priority: string, tags: string[], dates?: { [key: string]: string } }> = [];
        const lines = content.split('\n');

        console.log(`Parsing tasks from ${lines.length} lines of content`);

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            console.log(`Processing line: "${trimmed}"`);

            // Detect priority indicators
            let priority = '';
            let taskText = trimmed;
            let dates: { [key: string]: string } = {};

            // Remove bullet points if present
            taskText = taskText.replace(/^[-*•]\s*/, '');

            // Check for priority indicators (!, !!, !!!!, HIGH, MEDIUM, LOW)
            if (taskText.match(/^!!!|^HIGH:/i)) {
                priority = '⏫'; // Highest priority
                taskText = taskText.replace(/^(!!!|HIGH:)/i, '').trim();
            } else if (taskText.match(/^!!|^MEDIUM:/i)) {
                priority = '🔼'; // High priority
                taskText = taskText.replace(/^(!!|MEDIUM:)/i, '').trim();
            } else if (taskText.match(/^!|^LOW:/i)) {
                priority = '🔽'; // Medium priority
                taskText = taskText.replace(/^(!|LOW:)/i, '').trim();
            }

            // Extract date indicators
            const dueMatch = taskText.match(/\b(?:by|due)\s+(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+\w+|[\w\s]+?)(?=\s*[-,]|\s*$)/i);
            if (dueMatch) {
                const parsedDate = this.parseNaturalDate(dueMatch[1]);
                if (parsedDate) {
                    dates['due'] = parsedDate;
                    taskText = taskText.replace(dueMatch[0], '').trim();
                }
            }

            const scheduledMatch = taskText.match(/\b(?:scheduled|on)\s+(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+\w+|[\w\s]+?)(?=\s*[-,]|\s*$)/i);
            if (scheduledMatch) {
                const parsedDate = this.parseNaturalDate(scheduledMatch[1]);
                if (parsedDate) {
                    dates['scheduled'] = parsedDate;
                    taskText = taskText.replace(scheduledMatch[0], '').trim();
                }
            }

            const startMatch = taskText.match(/\b(?:start|begin|starting)\s+(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+\w+|[\w\s]+?)(?=\s*[-,]|\s*$)/i);
            if (startMatch) {
                const parsedDate = this.parseNaturalDate(startMatch[1]);
                if (parsedDate) {
                    dates['start'] = parsedDate;
                    taskText = taskText.replace(startMatch[0], '').trim();
                }
            }

            // Extract any hashtags from the task
            const tags: string[] = [];
            const tagMatches = taskText.match(/#[\w-]+/g);
            if (tagMatches) {
                tags.push(...tagMatches);
                // Remove tags from task text
                taskText = taskText.replace(/#[\w-]+/g, '').trim();
            }

            // Add default tag if configured
            if (this.settings.defaultTaskTags) {
                const defaultTags = this.settings.defaultTaskTags.split(',').map(t => {
                    const tag = t.trim();
                    return tag.startsWith('#') ? tag : '#' + tag;
                });
                tags.push(...defaultTags);
            }

            // Clean up any remaining punctuation at the end
            taskText = taskText.replace(/[,\-]+$/, '').trim();

            if (taskText) {
                console.log(`Added task: "${taskText}" with priority: "${priority}" and dates:`, dates);
                tasks.push({
                    text: taskText,
                    priority,
                    tags: [...new Set(tags)],
                    dates: Object.keys(dates).length > 0 ? dates : undefined
                });
            }
        }

        console.log(`Parsed ${tasks.length} total tasks`);
        return tasks;
    }

    formatTaskForObsidianTasks(task: { text: string, priority: string, tags: string[], dates?: { [key: string]: string } }): string {
        let formatted = '- [ ] ';

        // Add priority if enabled and present
        if (this.settings.taskPriorities && task.priority) {
            formatted += task.priority + ' ';
        }

        // Add task text
        formatted += task.text;

        // Add dates with proper emojis
        if (task.dates) {
            if (task.dates['due']) formatted += ` 📅 ${task.dates['due']}`;
            if (task.dates['scheduled']) formatted += ` ⏳ ${task.dates['scheduled']}`;
            if (task.dates['start']) formatted += ` 🛫 ${task.dates['start']}`;
        }

        // Add creation date (➕ is the correct emoji for created date in Obsidian Tasks)
        formatted += ` ➕ ${window.moment().format('YYYY-MM-DD')}`;

        // Add tags
        if (task.tags.length > 0) {
            formatted += ' ' + task.tags.join(' ');
        }

        return formatted;
    }

    parseNaturalDate(dateString: string, baseDate?: moment.Moment): string | null {
        const today = baseDate || window.moment();
        const normalizedDate = dateString.toLowerCase().trim();

        // Handle relative dates
        if (normalizedDate === 'today' || normalizedDate === 'tonight') return today.format('YYYY-MM-DD');
        if (normalizedDate === 'tomorrow') return today.clone().add(1, 'day').format('YYYY-MM-DD');
        if (normalizedDate === 'yesterday') return today.clone().subtract(1, 'day').format('YYYY-MM-DD');

        // Handle "next" patterns
        const nextMatch = normalizedDate.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|year)$/);
        if (nextMatch) {
            const unit = nextMatch[1];
            if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(unit)) {
                const targetDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(unit);
                let nextDate = today.clone();
                // Move to next week if we've passed this day already
                if (nextDate.day() >= targetDay) {
                    nextDate.add(1, 'week');
                }
                nextDate.day(targetDay);
                return nextDate.format('YYYY-MM-DD');
            }
            if (unit === 'week') return today.clone().add(1, 'week').format('YYYY-MM-DD');
            if (unit === 'month') return today.clone().add(1, 'month').format('YYYY-MM-DD');
            if (unit === 'year') return today.clone().add(1, 'year').format('YYYY-MM-DD');
        }

        // Try parsing with moment directly for standard formats
        const parsed = window.moment(dateString, ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'MMM DD, YYYY', 'MMMM DD, YYYY'], true);
        if (parsed.isValid()) {
            return parsed.format('YYYY-MM-DD');
        }

        return null;
    }

    async getAndEnsureFolder(pathTemplate: string): Promise<string> {
        let folderPath = pathTemplate.trim();
        if (!folderPath || folderPath === "/") { return ""; }

        if (!pathTemplate.includes("{notebook}")) {
            folderPath = folderPath.replace(/YYYY/g, window.moment().format("YYYY"))
                .replace(/MM/g, window.moment().format("MM"))
                .replace(/DD/g, window.moment().format("DD"));
        }

        // Remove any trailing slashes
        folderPath = folderPath.replace(/\/+$/, '');
        // Remove any duplicate slashes
        folderPath = folderPath.replace(/\/+/g, '/');

        if (!(await this.app.vault.adapter.exists(folderPath))) {
            try {
                await this.app.vault.createFolder(folderPath);
            } catch (error) {
                new Notice(`Error creating folder: ${folderPath}.`);
                console.error("Error creating folder:", error);
                return "";
            }
        }
        return folderPath;
    }

    parseDetectedTags(responseText: string | null): string[] {
        if (!responseText) return [];
        const tagRegex = /### Detected Tags\s*\n(.*?)(?:\n###|$)/s;
        const match = responseText.match(tagRegex);
        if (match && match[1] && match[1].toLowerCase().trim() !== 'none identified.') {
            return match[1].split(',').map(tag => tag.trim()).filter(tag => tag);
        }
        return [];
    }

    async updateNoteProperties(imageFile: TFile, noteFile: TFile, detectedTags: string[] = [], locationTag: string | null, notebookId: string | null, pageNumber: number | null) {
        const currentYear = new Date().getFullYear();
        const customTags = this.settings.customTags.split(',').map(tag => tag.trim()).filter(tag => tag);
        const notebook = notebookId ? this.settings.notebooks.find(n => n.id === notebookId) : null;

        await this.app.fileManager.processFrontMatter(noteFile, (frontmatter) => {
            frontmatter.tags = frontmatter.tags || [];
            if (!Array.isArray(frontmatter.tags)) { frontmatter.tags = [frontmatter.tags]; }

            const tagsToAdd = [`notes${currentYear}`, ...customTags, ...detectedTags];
            if (locationTag) tagsToAdd.push(locationTag);
            if (notebook) tagsToAdd.push(`notebook-${notebook.name.toLowerCase().replace(/\s+/g, '-')}`);

            for (const tag of tagsToAdd) {
                if (tag && !frontmatter.tags.includes(tag)) {
                    frontmatter.tags.push(tag);
                }
            }

            frontmatter.image = imageFile.name;

            // Add the created date
            frontmatter.created = window.moment().format('YYYY-MM-DD');

            if (notebook) {
                frontmatter.notebook = notebook.name;
                frontmatter.notebook_id = notebook.id;
                if (pageNumber) frontmatter.page = pageNumber;
            }
        });
    }

    processExtractedTasks(tasksSection: string): string {
        if (!tasksSection || tasksSection.toLowerCase().trim() === 'none identified.') {
            return 'None identified.';
        }

        console.log('Processing tasks section:', tasksSection);

        const lines = tasksSection.split('\n');
        const processedTasks: string[] = [];
        const creationDate = window.moment().format('YYYY-MM-DD');

        // Get default tags if configured
        let defaultTags = '';
        if (this.settings.defaultTaskTags) {
            const tags = this.settings.defaultTaskTags.split(',').map(t => {
                const tag = t.trim();
                return tag.startsWith('#') ? tag : '#' + tag;
            });
            defaultTags = ' ' + tags.join(' ');
        }

        for (const line of lines) {
            let trimmed = line.trim();
            if (!trimmed) continue;

            console.log('Processing task line:', trimmed);

            // Check if it's already a checkbox item
            const checkboxMatch = trimmed.match(/^-\s*\[\s*\]\s*(.+)/);
            let taskText = '';

            if (checkboxMatch) {
                taskText = checkboxMatch[1];
            } else if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
                // Convert bullet points to tasks
                taskText = trimmed.replace(/^[-*]\s*/, '').trim();
            } else if (!trimmed.startsWith('#') && trimmed.length > 0) {
                // Treat any non-header line as a potential task
                taskText = trimmed;
            }

            if (taskText) {
                let priority = '';
                let dates: { [key: string]: string } = {};

                // Check for priority indicators
                if (taskText.match(/^!!!|^HIGH:/i)) {
                    priority = '⏫ ';
                    taskText = taskText.replace(/^(!!!|HIGH:)/i, '').trim();
                } else if (taskText.match(/^!!|^MEDIUM:/i)) {
                    priority = '🔼 ';
                    taskText = taskText.replace(/^(!!|MEDIUM:)/i, '').trim();
                } else if (taskText.match(/^!|^LOW:/i)) {
                    priority = '🔽 ';
                    taskText = taskText.replace(/^(!|LOW:)/i, '').trim();
                }

                // Extract and parse date indicators
                const dueMatch = taskText.match(/\bDUE:\s*([^,\s]+(?:\s+[^,\s]+)*?)(?=\s*(?:SCHEDULED:|START:|$))/i);
                if (dueMatch) {
                    const parsedDate = this.parseNaturalDate(dueMatch[1]);
                    if (parsedDate) {
                        dates['due'] = parsedDate;
                        taskText = taskText.replace(dueMatch[0], '').trim();
                    }
                }

                const scheduledMatch = taskText.match(/\bSCHEDULED:\s*([^,\s]+(?:\s+[^,\s]+)*?)(?=\s*(?:DUE:|START:|$))/i);
                if (scheduledMatch) {
                    const parsedDate = this.parseNaturalDate(scheduledMatch[1]);
                    if (parsedDate) {
                        dates['scheduled'] = parsedDate;
                        taskText = taskText.replace(scheduledMatch[0], '').trim();
                    }
                }

                const startMatch = taskText.match(/\bSTART:\s*([^,\s]+(?:\s+[^,\s]+)*?)(?=\s*(?:DUE:|SCHEDULED:|$))/i);
                if (startMatch) {
                    const parsedDate = this.parseNaturalDate(startMatch[1]);
                    if (parsedDate) {
                        dates['start'] = parsedDate;
                        taskText = taskText.replace(startMatch[0], '').trim();
                    }
                }

                // Build the formatted task with Obsidian Tasks syntax
                let formattedTask = `- [ ] ${priority}${taskText}`;

                // Add dates with proper emojis
                if (dates['due']) formattedTask += ` 📅 ${dates['due']}`;
                if (dates['scheduled']) formattedTask += ` ⏳ ${dates['scheduled']}`;
                if (dates['start']) formattedTask += ` 🛫 ${dates['start']}`;
                formattedTask += ` ➕ ${creationDate}`;
                formattedTask += defaultTags;

                console.log('Formatted task:', formattedTask);
                processedTasks.push(formattedTask);
            }
        }

        return processedTasks.join('\n');
    }

    async callGeminiAPI(imageData: ArrayBuffer): Promise<string | null> {
        const apiKey = this.settings.geminiApiKey;
        const model = this.settings.selectedModel;
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const imageBase64 = arrayBufferToBase64(imageData);

        let promptText = this.settings.geminiPrompt;

        if (this.settings.enableDeepResearch) {
            promptText += `

### Deep Research
[Also, identify any product names, technologies, or key concepts mentioned in the note. For each item, provide a brief, one-sentence description and a relevant URL (like an official website or Wikipedia page) for more information. Format each item as a bullet point. If none are found, write "None identified."]`;
        }

        const requestBody = { "contents": [{ "parts": [{ "text": promptText }, { "inline_data": { "mime_type": "image/jpeg", "data": imageBase64 } }] }] };

        try {
            const response = await requestUrl({ url: API_URL, method: 'POST', contentType: 'application/json', body: JSON.stringify(requestBody) });
            const geminiResponse = response.json;
            if (geminiResponse.candidates && geminiResponse.candidates[0]?.content?.parts?.[0]?.text) {
                let responseText = geminiResponse.candidates[0].content.parts[0].text;

                // Process the Tasks section to add Obsidian Tasks formatting
                const tasksRegex = /### Tasks\s*\n([\s\S]*?)(?=\n###|$)/;
                const tasksMatch = responseText.match(tasksRegex);
                if (tasksMatch && tasksMatch[1]) {
                    console.log('Found Tasks section, processing...');
                    const processedTasks = this.processExtractedTasks(tasksMatch[1]);
                    responseText = responseText.replace(tasksMatch[0], `### Tasks\n${processedTasks}`);
                }

                return responseText;
            } else { throw new Error("Unexpected response structure from Gemini API"); }
        } catch (error) {
            console.error("Gemini API call failed:", error);
            throw error;
        }
    }

    detectTriggerWords(text: string): Array<{ trigger: string, content: string, action: TriggerAction }> {
        const triggers: Array<{ trigger: string, content: string, action: TriggerAction }> = [];
        const underlineRegex = /(?:<u>([\w\s]+)<\/u>|__([\w\s]+)__)\s*:?\s*([\s\S]*?)(?=(?:<u>|__|\n\n|$))/gi;
        let match;
        while ((match = underlineRegex.exec(text)) !== null) {
            const underlinedText = (match[1] || match[2]).trim();
            const content = match[3].trim();
            const translateMatch = underlinedText.match(/^Translate\s+(?:to|into)\s+(\w+)$/i);
            if (translateMatch) {
                const targetLanguage = translateMatch[1];
                const translateAction = this.settings.triggerActions.find(a => a.action === 'translate' && a.enabled);
                if (translateAction) {
                    triggers.push({
                        trigger: `Translate to ${targetLanguage}`,
                        content: content,
                        action: { ...translateAction, keyword: `Translate to ${targetLanguage}` }
                    });
                }
                continue;
            }
            const firstWord = underlinedText.split(/\s+/)[0];
            const action = this.settings.triggerActions.find(a => a.keyword.toLowerCase() === firstWord.toLowerCase() && a.enabled);
            if (action) {
                triggers.push({ trigger: firstWord, content: content, action: action });
            }
        }
        return triggers;
    }

    async processTriggerWithGemini(trigger: { trigger: string, content: string, action: TriggerAction }): Promise<string> {
        const lengthInstructions: Record<string, string> = {
            'brief': 'Provide a concise response, 2-3 sentences per item.',
            'moderate': 'Provide a balanced response, 1-2 paragraphs per item.',
            'detailed': 'Provide a comprehensive response with full explanations, examples, and context.'
        };
        let translationLanguage = '';
        if (trigger.action.action === 'translate') {
            const langMatch = trigger.trigger.match(/Translate\s+(?:to|into)\s+(\w+)/i);
            if (langMatch) { translationLanguage = langMatch[1]; }
        }
        const prompts: Record<string, string> = {
            'research': `Research the following topics and provide ${lengthInstructions[this.settings.researchResponseLength]} Format as a numbered list matching the input:\n${trigger.content}`,
            'expand': `Take this brief note or concept and expand it into detailed, well-structured paragraphs: \n${trigger.content}\n${lengthInstructions[this.settings.researchResponseLength]}`,
            'summarize': `Create a concise summary of the following content. Include key points and takeaways:\n${trigger.content}`,
            'actions': `Extract all action items from this content and create a prioritized task list with suggested deadlines:\n${trigger.content}`,
            'tasks': `Format the following as a task list:\n${trigger.content}`,
            'analyze': `Provide a critical analysis of the following. Include pros/cons, potential risks, and opportunities:\n${trigger.content}`,
            'define': `Provide clear definitions with examples for these terms:\n${trigger.content}`,
            'translate': translationLanguage ? `Translate the following content to ${translationLanguage}. Provide only the translation, maintaining the same format and structure as the original:\n${trigger.content}` : `Translate the following content. Target language is specified first, then the content:\n${trigger.content}`,
            'rewrite': `Rewrite the following content in the specified style (formal/casual/technical/email/etc):\n${trigger.content}`,
            'questions': `Generate thought-provoking questions about this topic to encourage deeper thinking:\n${trigger.content}`,
            'connect': `Identify connections to other concepts, related topics, and interdisciplinary links for:\n${trigger.content}`,
            'organize': `Organize the following content into a clear, logical structure with categories and priorities:\n${trigger.content}`,
            'taglinks': 'Finding related notes by tags...', // This is handled specially
            'related': 'Finding related notes by tags...' // This is handled specially
        };
        const prompt = prompts[trigger.action.action] || `Process: ${trigger.content}`;
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${this.settings.selectedModel}:generateContent?key=${this.settings.geminiApiKey}`;
        const requestBody = { "contents": [{ "parts": [{ "text": prompt }] }] };
        try {
            const response = await requestUrl({ url: API_URL, method: 'POST', contentType: 'application/json', body: JSON.stringify(requestBody) });
            const geminiResponse = response.json;
            if (geminiResponse.candidates && geminiResponse.candidates[0]?.content?.parts?.[0]?.text) {
                return `### ${trigger.trigger} Results\n${geminiResponse.candidates[0].content.parts[0].text}`;
            }
        } catch (error) {
            console.error(`Failed to process trigger "${trigger.trigger}":`, error);
            return `### ${trigger.trigger} - Processing Failed\nCould not process this trigger action.`;
        }
        return '';
    }
}

// Settings Tab Class
class GeminiSettingTab extends PluginSettingTab {
    plugin: GeminiNoteProcessor;
    constructor(app: App, plugin: GeminiNoteProcessor) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Gemini Note Processor Settings' });

        // Support/Donation Section
        const supportSection = containerEl.createDiv({ cls: 'setting-item' });
        supportSection.style.cssText = 'padding: 20px; background: var(--background-modifier-hover); border-radius: 8px; margin-bottom: 20px; text-align: center;';

        supportSection.createEl('p', {
            text: 'If you find this plugin helpful, consider supporting its development!',
            cls: 'setting-item-description'
        });

        const coffeeLink = supportSection.createEl('a', {
            href: 'https://buymeacoffee.com/farsonic',
            attr: { target: '_blank' }
        });

        const coffeeImg = coffeeLink.createEl('img', {
            attr: {
                src: 'https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png',
                alt: 'Buy Me A Coffee'
            }
        });
        coffeeImg.style.cssText = 'height: 60px; width: 217px; margin-top: 10px;';

        supportSection.createEl('p', {
            text: '☕ Your support helps keep this plugin maintained and improved!',
            cls: 'setting-item-description'
        });

        // Main Settings
        new Setting(containerEl)
            .setName('Gemini API Key')
            .setDesc('Your Google AI Studio API key for Gemini')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.geminiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.geminiApiKey = value;
                    await this.plugin.saveSettings();
                }));

        // PROMPT CONFIGURATION SECTION - SIMPLIFIED
        containerEl.createEl('h2', { text: 'Prompt Configuration' });

        // Simple setting with just the text area
        new Setting(containerEl)
            .setName('Gemini Prompt')
            .setDesc('Edit the prompt that tells Gemini how to process your notes (be careful with changes)')
            .addTextArea(text => {
                // Get the current value with inline fallback
                const fallbackPrompt = `You are an expert note-processing assistant integrated into Obsidian. I am providing you with an image of a handwritten note.`;
                const currentValue = this.plugin.settings.geminiPrompt || fallbackPrompt;

                // Set the value
                text.setValue(currentValue);

                // Style the text area
                text.inputEl.style.width = '100%';
                text.inputEl.style.height = '300px';
                text.inputEl.style.fontSize = '11px';
                text.inputEl.style.fontFamily = 'monospace';

                // Add change handler
                text.onChange(async (value) => {
                    this.plugin.settings.geminiPrompt = value;
                    await this.plugin.saveSettings();
                });

                return text;
            });

        // Reset button in its own setting
        new Setting(containerEl)
            .setName('Reset Prompt')
            .setDesc('Reset the prompt to the default template')
            .addButton(button => button
                .setButtonText('Reset to Default')
                .onClick(async () => {
                    // Use the full default prompt inline
                    this.plugin.settings.geminiPrompt = DEFAULT_GEMINI_PROMPT;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        containerEl.createEl('h2', { text: 'Notebook Management' });
        new Setting(containerEl)
            .setName('Group Notes by Notebook').setDesc('Organize captured notes into notebook-specific folders')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.groupByNotebook)
                .onChange(async (value) => { this.plugin.settings.groupByNotebook = value; await this.plugin.saveSettings(); }));
        new Setting(containerEl)
            .setName('Auto-increment Page Numbers').setDesc('Automatically increment page number after each capture')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.autoIncrementPage)
                .onChange(async (value) => { this.plugin.settings.autoIncrementPage = value; await this.plugin.saveSettings(); }));
        new Setting(containerEl)
            .setName('Notebook Folder Pattern').setDesc('Folder structure for notebook organization. Use {notebook} for notebook name.')
            .addText(text => text.setPlaceholder('Notebooks/{notebook}/YYYY-MM').setValue(this.plugin.settings.notebookFolderPattern)
                .onChange(async (value) => { this.plugin.settings.notebookFolderPattern = value; await this.plugin.saveSettings(); }));

        containerEl.createEl('h3', { text: 'Manage Notebooks' });
        containerEl.createEl('p', { text: 'Add and manage your physical notebooks.', cls: 'setting-item-description' });
        new Setting(containerEl)
            .setName('Add New Notebook').setDesc('Create a new notebook entry')
            .addButton(button => button.setButtonText('Add Notebook')
                .onClick(async () => {
                    const newNotebook = this.plugin.createNotebook();
                    this.plugin.settings.notebooks.push(newNotebook);
                    await this.plugin.saveSettings();
                    this.display();
                }));

        this.plugin.settings.notebooks.forEach((notebook, index) => {
            const setting = new Setting(containerEl)
                .setName(notebook.name).setDesc(`Status: ${notebook.status} | Current Page: ${notebook.currentPage}${notebook.totalPages ? `/${notebook.totalPages}` : ''}`);
            setting.addText(text => text.setPlaceholder('Notebook name').setValue(notebook.name)
                .onChange(async (value) => { notebook.name = value; await this.plugin.saveSettings(); }));
            setting.addText(text => text.setPlaceholder('Page').setValue(notebook.currentPage.toString())
                .onChange(async (value) => {
                    const pageNum = parseInt(value);
                    if (!isNaN(pageNum) && pageNum > 0) { notebook.currentPage = pageNum; await this.plugin.saveSettings(); }
                })).setTooltip('Current page number');
            setting.addDropdown(dropdown => dropdown
                .addOption('active', 'Active').addOption('completed', 'Completed').addOption('archived', 'Archived')
                .setValue(notebook.status).onChange(async (value) => {
                    notebook.status = value as 'active' | 'completed' | 'archived';
                    await this.plugin.saveSettings(); this.display();
                }));
            setting.addButton(button => button.setButtonText('Delete').setWarning()
                .onClick(async () => {
                    if (confirm(`Delete notebook "${notebook.name}"? This won't delete existing notes.`)) {
                        this.plugin.settings.notebooks.splice(index, 1);
                        await this.plugin.saveSettings(); this.display();
                    }
                }));
        });

        containerEl.createEl('h2', { text: 'File Organization' });
        new Setting(containerEl)
            .setName('New Note Location').setDesc('Default folder for new notes (when not using notebooks). Supports YYYY, MM, DD placeholders.')
            .addText(text => text.setPlaceholder('e.g., Scans/YYYY-MM').setValue(this.plugin.settings.newNoteLocation)
                .onChange(async (value) => { this.plugin.settings.newNoteLocation = value; await this.plugin.saveSettings(); }));
        new Setting(containerEl)
            .setName('Attachment Location').setDesc('Folder for new image attachments. Supports YYYY, MM, DD.')
            .addText(text => text.setPlaceholder('e.g., Scans/YYYY-MM/Attachments').setValue(this.plugin.settings.attachmentLocation)
                .onChange(async (value) => { this.plugin.settings.attachmentLocation = value; await this.plugin.saveSettings(); }));
        new Setting(containerEl)
            .setName('Custom Tags').setDesc('Comma-separated tags to add to note properties.')
            .addText(text => text.setPlaceholder('e.g., sketchnote, from-notebook').setValue(this.plugin.settings.customTags)
                .onChange(async (value) => { this.plugin.settings.customTags = value; await this.plugin.saveSettings(); }));

        containerEl.createEl('h2', { text: 'Processing Options' });
        new Setting(containerEl)
            .setName('Enable Deep Research').setDesc('Gemini will also research topics found in the note.')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.enableDeepResearch)
                .onChange(async (value) => { this.plugin.settings.enableDeepResearch = value; await this.plugin.saveSettings(); }));
        new Setting(containerEl)
            .setName('Enable Location Tagging').setDesc('Extract location from photo EXIF data and add as a country tag.')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.enableLocationTagging)
                .onChange(async (value) => { this.plugin.settings.enableLocationTagging = value; await this.plugin.saveSettings(); }));
        new Setting(containerEl)
            .setName('Fallback to Current Location').setDesc('If no GPS data in photo, use your current location instead (requires location permission).')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.fallbackToCurrentLocation)
                .onChange(async (value) => { this.plugin.settings.fallbackToCurrentLocation = value; await this.plugin.saveSettings(); }));

        // Discussion Settings
        containerEl.createEl('h2', { text: 'Discussion Settings' });
        new Setting(containerEl)
            .setName('Enable Discussion Links')
            .setDesc('Add a link to discuss the note with Gemini at the top of processed notes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDiscussionLinks)
                .onChange(async (value) => {
                    this.plugin.settings.enableDiscussionLinks = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.enableDiscussionLinks) {
            new Setting(containerEl)
                .setName('Discussion Link Text')
                .setDesc('Customize the text for the discussion link')
                .addText(text => text
                    .setPlaceholder('💬 Discuss this note with Gemini')
                    .setValue(this.plugin.settings.discussionLinkText)
                    .onChange(async (value) => {
                        this.plugin.settings.discussionLinkText = value || '💬 Discuss this note with Gemini';
                        await this.plugin.saveSettings();
                    }));

            containerEl.createEl('p', {
                text: '💡 You can also use the command palette (Ctrl/Cmd+P) to open Gemini Chat for any note.',
                cls: 'setting-item-description'
            });
        }

        containerEl.createEl('h2', { text: 'Trigger Words' });
        new Setting(containerEl)
            .setName('Enable Trigger Words').setDesc('Process underlined keywords as special triggers for additional Gemini actions')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.enableTriggerWords)
                .onChange(async (value) => { this.plugin.settings.enableTriggerWords = value; this.display(); }));

        if (this.plugin.settings.enableTriggerWords) {
            new Setting(containerEl)
                .setName('Research Response Length').setDesc('How detailed should triggered research responses be?')
                .addDropdown(dropdown => dropdown
                    .addOption('brief', 'Brief (2-3 sentences)').addOption('moderate', 'Moderate (1-2 paragraphs)').addOption('detailed', 'Detailed (comprehensive)')
                    .setValue(this.plugin.settings.researchResponseLength).onChange(async (value) => {
                        this.plugin.settings.researchResponseLength = value as 'brief' | 'moderate' | 'detailed'; await this.plugin.saveSettings();
                    }));

            containerEl.createEl('h3', { text: 'Trigger Words Configuration' });
            containerEl.createEl('p', {
                text: 'Enable/disable specific trigger words. Underline words in your handwritten notes to activate these AI-powered actions.',
                cls: 'setting-item-description'
            });

            for (const action of this.plugin.settings.triggerActions) {
                if ((action.keyword === 'Summarise' && this.plugin.settings.triggerActions.find(a => a.keyword === 'Summarize')) ||
                    (action.keyword === 'Analyse' && this.plugin.settings.triggerActions.find(a => a.keyword === 'Analyze')) ||
                    (action.keyword === 'Organise' && this.plugin.settings.triggerActions.find(a => a.keyword === 'Organize'))) {
                    continue;
                }

                let description = this.getTriggerUsageDescription(action.keyword, action.action);

                new Setting(containerEl)
                    .setName(action.keyword).setDesc(description)
                    .addToggle(toggle => toggle.setValue(action.enabled)
                        .onChange(async (value) => {
                            const spellingVariants: Record<string, string[]> = {
                                'Summarize': ['Summarize', 'Summarise'], 'Analyze': ['Analyze', 'Analyse'], 'Organize': ['Organize', 'Organise']
                            };
                            const variants = spellingVariants[action.keyword] || [action.keyword];
                            for (const variant of variants) {
                                const index = this.plugin.settings.triggerActions.findIndex(a => a.keyword === variant);
                                if (index !== -1) { this.plugin.settings.triggerActions[index].enabled = value; }
                            }
                            await this.plugin.saveSettings();
                        }));
            }
        }

        containerEl.createEl('h2', { text: 'Obsidian Tasks Integration' });
        containerEl.createEl('p', {
            text: 'Integrate with Obsidian Tasks plugin to automatically add captured tasks to your task management system.',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
            .setName('Enable Tasks Integration')
            .setDesc('Automatically add tasks to your Obsidian Tasks note when using the "Tasks" trigger word')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableTasksIntegration)
                .onChange(async (value) => {
                    this.plugin.settings.enableTasksIntegration = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.enableTasksIntegration) {
            new Setting(containerEl)
                .setName('Tasks Note Path')
                .setDesc('Path to your main tasks note (e.g., Tasks/Inbox.md)')
                .addText(text => text
                    .setPlaceholder('Tasks/Inbox.md')
                    .setValue(this.plugin.settings.tasksNotePath)
                    .onChange(async (value) => {
                        this.plugin.settings.tasksNotePath = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Tasks Section Heading')
                .setDesc('Heading under which captured tasks will be added')
                .addText(text => text
                    .setPlaceholder('## Captured Tasks')
                    .setValue(this.plugin.settings.tasksSectionHeading)
                    .onChange(async (value) => {
                        this.plugin.settings.tasksSectionHeading = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Enable Priority Markers')
                .setDesc('Detect priority markers (!, !!, !!!) and add priority emojis to tasks')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.taskPriorities)
                    .onChange(async (value) => {
                        this.plugin.settings.taskPriorities = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Default Task Tags')
                .setDesc('Tags to add to all captured tasks (comma-separated, # optional)')
                .addText(text => text
                    .setPlaceholder('#captured, #from-paper')
                    .setValue(this.plugin.settings.defaultTaskTags)
                    .onChange(async (value) => {
                        this.plugin.settings.defaultTaskTags = value;
                        await this.plugin.saveSettings();
                    }));

            containerEl.createEl('p', {
                text: '💡 How to use: Underline "Tasks" in your handwritten notes, then list tasks below.',
                cls: 'setting-item-description'
            });
        }

        containerEl.createEl('h2', { text: 'Platform-Specific Settings' });
        new Setting(containerEl)
            .setName('Android Camera Mode').setDesc('Choose how to capture images on Android devices')
            .addDropdown(dropdown => dropdown
                .addOption('ask', 'Ask each time')
                .addOption('camera', 'Direct camera (may not work)')
                .addOption('gallery', 'Gallery picker (recommended)')
                .setValue(this.plugin.settings.androidCameraMode)
                .onChange(async (value) => {
                    this.plugin.settings.androidCameraMode = value as 'camera' | 'gallery' | 'ask';
                    await this.plugin.saveSettings();
                }));
        containerEl.createEl('p', {
            text: '💡 Tip: If camera access fails on Android, use Gallery mode.',
            cls: 'setting-item-description'
        });

        // FOLDER MONITORING SECTION
        containerEl.createEl('h2', { text: 'Automatic Folder Monitoring' });
        containerEl.createEl('p', {
            text: 'Automatically process files that appear in a specified folder.',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
            .setName('Enable Folder Monitoring')
            .setDesc('Automatically monitor and process files from a specified folder')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.folderMonitor.enabled)
                .onChange(async (value) => {
                    this.plugin.settings.folderMonitor.enabled = value;
                    await this.plugin.saveSettings();

                    // Start or stop the monitor
                    if (value) {
                        this.plugin.folderMonitor.start();
                        new Notice('Folder monitoring started');
                    } else {
                        this.plugin.folderMonitor.stop();
                        new Notice('Folder monitoring stopped');
                    }

                    this.display();
                }));

        if (this.plugin.settings.folderMonitor.enabled) {
            new Setting(containerEl)
                .setName('Watch Folder')
                .setDesc('Folder to monitor for new files (relative to vault root)')
                .addText(text => text
                    .setPlaceholder('Inbox')
                    .setValue(this.plugin.settings.folderMonitor.watchFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.folderMonitor.watchFolder = value;
                        await this.plugin.saveSettings();
                        this.plugin.folderMonitor.stop();
                        this.plugin.folderMonitor.start();
                    }));

            new Setting(containerEl)
                .setName('File Pattern')
                .setDesc('Pattern to match files (e.g., "scan-*" matches scan-001.png, scan-002.pdf). Use * for any characters, ? for single character.')
                .addText(text => text
                    .setPlaceholder('scan-*')
                    .setValue(this.plugin.settings.folderMonitor.filePattern)
                    .onChange(async (value) => {
                        this.plugin.settings.folderMonitor.filePattern = value || '*';
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Output Folder')
                .setDesc('Where to save processed notes. Supports YYYY, MM, DD placeholders.')
                .addText(text => text
                    .setPlaceholder('Gemini Scans/Auto-Processed/YYYY-MM')
                    .setValue(this.plugin.settings.folderMonitor.outputFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.folderMonitor.outputFolder = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Check Interval')
                .setDesc('How often to check for new files (in seconds, minimum 5)')
                .addText(text => text
                    .setPlaceholder('30')
                    .setValue(this.plugin.settings.folderMonitor.checkInterval.toString())
                    .onChange(async (value) => {
                        const interval = parseInt(value);
                        if (!isNaN(interval) && interval >= 5) {
                            this.plugin.settings.folderMonitor.checkInterval = interval;
                            await this.plugin.saveSettings();
                            // Restart monitor with new interval
                            this.plugin.folderMonitor.stop();
                            this.plugin.folderMonitor.start();
                        }
                    }));

            // File handling options
            containerEl.createEl('h3', { text: 'File Handling' });

            new Setting(containerEl)
                .setName('After Processing Action')
                .setDesc('What to do with original files after processing')
                .addDropdown(dropdown => dropdown
                    .addOption('move', 'Move to Processed folder')
                    .addOption('delete', 'Delete original files')
                    .setValue(this.plugin.settings.folderMonitor.deleteAfterProcessing ? 'delete' : 'move')
                    .onChange(async (value) => {
                        this.plugin.settings.folderMonitor.deleteAfterProcessing = (value === 'delete');
                        await this.plugin.saveSettings();
                        this.display();
                    }));

            if (!this.plugin.settings.folderMonitor.deleteAfterProcessing) {
                new Setting(containerEl)
                    .setName('Processed Folder')
                    .setDesc('Where to move processed files')
                    .addText(text => text
                        .setPlaceholder('Inbox/Processed')
                        .setValue(this.plugin.settings.folderMonitor.processedFolder)
                        .onChange(async (value) => {
                            this.plugin.settings.folderMonitor.processedFolder = value;
                            await this.plugin.saveSettings();
                        }));
            }

            // Notebook integration
            containerEl.createEl('h3', { text: 'Notebook Integration' });

            new Setting(containerEl)
                .setName('Use Notebook')
                .setDesc('Assign auto-processed files to a specific notebook')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.folderMonitor.useNotebook)
                    .onChange(async (value) => {
                        this.plugin.settings.folderMonitor.useNotebook = value;
                        await this.plugin.saveSettings();
                        this.display();
                    }));

            if (this.plugin.settings.folderMonitor.useNotebook) {
                const activeNotebooks = this.plugin.settings.notebooks.filter(n => n.status === 'active');

                if (activeNotebooks.length > 0) {
                    new Setting(containerEl)
                        .setName('Select Notebook')
                        .setDesc('Which notebook to use for auto-processed files')
                        .addDropdown(dropdown => {
                            dropdown.addOption('', 'Select a notebook...');
                            activeNotebooks.forEach(notebook => {
                                dropdown.addOption(notebook.id, `${notebook.name} (Page ${notebook.currentPage})`);
                            });
                            dropdown.setValue(this.plugin.settings.folderMonitor.notebookId)
                                .onChange(async (value) => {
                                    this.plugin.settings.folderMonitor.notebookId = value;
                                    await this.plugin.saveSettings();
                                });
                        });

                    new Setting(containerEl)
                        .setName('Auto-increment Pages')
                        .setDesc('Automatically increment page numbers for each processed file')
                        .addToggle(toggle => toggle
                            .setValue(this.plugin.settings.folderMonitor.autoIncrementPages)
                            .onChange(async (value) => {
                                this.plugin.settings.folderMonitor.autoIncrementPages = value;
                                await this.plugin.saveSettings();
                            }));
                } else {
                    containerEl.createEl('p', {
                        text: '⚠️ No active notebooks found. Create a notebook first.',
                        cls: 'setting-item-description'
                    });
                }
            }

            // Status and control
            containerEl.createEl('h3', { text: 'Monitor Status' });

            const statusContainer = containerEl.createDiv({ cls: 'setting-item' });
            statusContainer.style.cssText = 'padding: 10px; background: var(--background-modifier-hover); border-radius: 8px;';

            const lastProcessed = this.plugin.settings.folderMonitor.lastProcessedTime;
            const lastProcessedText = lastProcessed ?
                `Last check: ${window.moment(lastProcessed).fromNow()}` :
                'Not yet run';

            statusContainer.createEl('p', {
                text: `Status: ${this.plugin.folderMonitor?.isRunning() ? '🟢 Running' : '🔴 Stopped'}`,  // FIXED
                cls: 'setting-item-description'
            });

            const buttonContainer = statusContainer.createDiv();
            buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 10px;';

            buttonContainer.createEl('button', {
                text: '🔄 Check Now',
                cls: 'mod-cta'
            }).addEventListener('click', async () => {
                if (this.plugin.settings.folderMonitor.enabled) {
                    await this.plugin.folderMonitor.checkFolder();
                    new Notice('Checking monitored folder...');
                } else {
                    new Notice('Enable folder monitoring first');
                }
            });

            buttonContainer.createEl('button', {
                text: '🔄 Restart Monitor'
            }).addEventListener('click', () => {
                this.plugin.folderMonitor.stop();
                this.plugin.folderMonitor.start();
                new Notice('Monitor restarted');
                this.display();
            });

            // Help text
            containerEl.createEl('h3', { text: 'How it works' });
            const helpContainer = containerEl.createDiv({ cls: 'setting-item-description' });
            helpContainer.style.cssText = 'background: var(--background-secondary); padding: 15px; border-radius: 8px;';
            helpContainer.innerHTML = `
                <p><strong>Setup Instructions:</strong></p>
                <ol>
                    <li>Create an "Inbox" folder in your vault for incoming files</li>
                    <li>Set up your scanner/camera app to save files there with a consistent naming pattern (e.g., scan-001.png, scan-002.pdf)</li>
                    <li>Configure the file pattern to match your naming scheme</li>
                    <li>The monitor will check every ${this.plugin.settings.folderMonitor.checkInterval} seconds for new files</li>
                    <li>Matching files will be processed through Gemini and saved as notes</li>
                </ol>
                <p><strong>File Pattern Examples:</strong></p>
                <ul>
                    <li><code>scan-*</code> → matches scan-001.png, scan-abc.pdf</li>
                    <li><code>note-????</code> → matches note-0001.png, note-abcd.pdf (exactly 4 characters)</li>
                    <li><code>*</code> → matches all PNG and PDF files</li>
                    <li><code>IMG_*</code> → matches IMG_001.png, IMG_20231225.pdf</li>
                </ul>
            `;
        }
    }

    getTriggerUsageDescription(keyword: string, action: string): string {
        const descriptions: Record<string, string> = {
            'Research': "Deep research on topics you list below the underlined word.",
            'Expand': "Expands brief notes into detailed, well-structured content.",
            'Summarize': "Creates concise summaries of your content.",
            'Actions': "Extracts and prioritizes all action items with suggested deadlines.",
            'Tasks': "Adds tasks to your Obsidian Tasks note with priority and tags support.",
            'Analyze': "Provides critical analysis including pros, cons, risks and opportunities.",
            'Define': "Provides clear definitions with examples for terms listed below.",
            'Translate': "Translates content to your specified language.",
            'Rewrite': "Rewrites content in a different style (formal, casual, email, etc.).",
            'Questions': "Generates thought-provoking questions to encourage deeper thinking.",
            'Connect': "Identifies connections to related concepts and interdisciplinary links.",
            'Organize': "Organizes content into clear, logical structure with categories.",
            'TagLinks': "Finds and links to other notes with matching tags.",
            'Related': "Same as TagLinks - finds notes with matching tags."
        };

        // Handle spelling variants
        if (keyword === 'Summarise') return descriptions['Summarize'];
        if (keyword === 'Analyse') return descriptions['Analyze'];
        if (keyword === 'Organise') return descriptions['Organize'];

        return descriptions[keyword] || 'Process content';
    }
}