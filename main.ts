import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, requestUrl, Editor, moment, Modal } from 'obsidian';
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
    { keyword: 'Organize', action: 'organize', requiresList: false, enabled: true } // US spelling
];

const DEFAULT_GEMINI_PROMPT = `You are an expert note-processing assistant integrated into Obsidian. I am providing you with an image of a handwritten note. 
Perform the following tasks and format your response *exactly* as specified below, using Markdown. 
Do not include any other text, headers, or pleasantries in your response.

IMPORTANT: When transcribing, preserve formatting indicators:
- If a word appears underlined in the handwriting, format it as <u>word</u>
- Maintain numbered or bulleted lists exactly as they appear
- Keep the exact structure and organization of the original note
- If a table appears convert this to a markdown table 

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
}

const DEFAULT_SETTINGS: GeminiNoteProcessorSettings = {
    geminiApiKey: '',
    selectedModel: 'gemini-2.5-flash',
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
    defaultTaskTags: '#captured',
    geminiPrompt: DEFAULT_GEMINI_PROMPT
}

export default class GeminiNoteProcessor extends Plugin {
    settings: GeminiNoteProcessorSettings;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new GeminiSettingTab(this.app, this));

        this.addRibbonIcon('camera', 'Create note from camera or file', () => {
            this.createNoteFromImageCapture();
        });

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
    }

    onunload() { }

    async loadSettings() {
        const loadedData = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
        
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
            await this.saveSettings(); // Save it immediately
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
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

    async showNotebookSelectionModal(): Promise<{notebook: Notebook | null, pageNumber: number | null, cancelled: boolean}> {
        if (this.settings.notebooks.length === 0) {
            new Notice("No notebooks found. Creating a default notebook...");
            const defaultNotebook = this.createNotebook();
            defaultNotebook.name = "My Notebook";
            this.settings.notebooks.push(defaultNotebook);
            await this.saveSettings();
        }
        
        return new Promise((resolve) => {
            const modal = new Modal(this.app);
            modal.titleEl.setText('Select Notebook');
            
            let selectedNotebook: Notebook | null = null;
            let pageNumber: number | null = null;
            
            const formContainer = modal.contentEl.createDiv();
            
            formContainer.createEl('p', { 
                text: 'Which notebook is this page from?',
                cls: 'setting-item-description'
            });
            
            const notebookContainer = formContainer.createDiv({ cls: 'setting-item' });
            notebookContainer.createEl('label', { text: 'Notebook:' });
            const notebookSelect = notebookContainer.createEl('select', { cls: 'dropdown' });
            
            notebookSelect.createEl('option', { 
                value: '', 
                text: '📄 Loose paper or Whiteboard' 
            });
            
            const activeNotebooks = this.settings.notebooks.filter(n => n.status === 'active');
            if (activeNotebooks.length > 0) {
                const activeGroup = notebookSelect.createEl('optgroup', { attr: { label: 'Active Notebooks' } });
                activeNotebooks.forEach(notebook => {
                    activeGroup.createEl('option', {
                        value: notebook.id,
                        text: `📓 ${notebook.name} (Current page: ${notebook.currentPage})`
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
            
            if (this.settings.currentNotebookId) {
                notebookSelect.value = this.settings.currentNotebookId;
                selectedNotebook = this.settings.notebooks.find(n => n.id === this.settings.currentNotebookId) || null;
            }
            
            const pageContainer = formContainer.createDiv({ cls: 'setting-item' });
            pageContainer.style.display = selectedNotebook ? 'flex' : 'none';
            pageContainer.createEl('label', { text: 'Page number:' });
            const pageInput = pageContainer.createEl('input', {
                type: 'number',
                attr: { 
                    min: '1',
                    placeholder: 'Enter page number'
                }
            });
            
            if (selectedNotebook) {
                pageInput.value = selectedNotebook.currentPage.toString();
                pageNumber = selectedNotebook.currentPage;
            }
            
            const autoIncrementContainer = formContainer.createDiv({ cls: 'setting-item' });
            autoIncrementContainer.style.display = selectedNotebook ? 'flex' : 'none';
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
            
            notebookSelect.addEventListener('change', () => {
                const notebookId = notebookSelect.value;
                if (notebookId) {
                    selectedNotebook = this.settings.notebooks.find(n => n.id === notebookId) || null;
                    if (selectedNotebook) {
                        pageContainer.style.display = 'flex';
                        autoIncrementContainer.style.display = 'flex';
                        pageInput.value = selectedNotebook.currentPage.toString();
                        pageNumber = selectedNotebook.currentPage;
                    }
                } else {
                    selectedNotebook = null;
                    pageNumber = null;
                    pageContainer.style.display = 'none';
                    autoIncrementContainer.style.display = 'none';
                }
            });
            
            pageInput.addEventListener('input', () => {
                const value = parseInt(pageInput.value);
                if (!isNaN(value) && value > 0) {
                    pageNumber = value;
                }
            });
            
            const buttonContainer = formContainer.createDiv({ cls: 'modal-button-container' });
            
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
		try {
			const buffer = Buffer.from(imageData);
			const exifData: any = ExifReader(buffer); 
			
			if (exifData && exifData.gps && exifData.gps.Latitude && exifData.gps.Longitude) {
				console.log("Found GPS in EXIF:", exifData.gps);
				const country = await this.getCountryFromCoords(exifData.gps.Latitude, exifData.gps.Longitude);
				if (country) { 
					new Notice(`Location from photo: ${country}`); 
					return country; 
				}
			} else {
				console.log("No GPS data found in EXIF");
			}
		} catch (error) { 
			console.log("Could not parse EXIF data:", error.message); 
		}
		
		if (this.settings.fallbackToCurrentLocation) {
			console.log("Falling back to current location");
			const currentCoords = await this.getCurrentCoords();
			if (currentCoords) {
				const country = await this.getCountryFromCoords(currentCoords.latitude, currentCoords.longitude);
				if (country) { 
					new Notice(`Using current location: ${country}`); 
					return country; 
				}
			}
		}
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
				editor.replaceRange(`\n\n---\n${resultText}\n---`, { line: cursor.line, ch: lineContent.length });
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
                        </div>
                        <details style="margin-top: 20px; text-align: left;">
                            <summary style="cursor: pointer; font-weight: bold;">Advanced: Try to Fix Camera Access</summary>
                            <ol style="margin-top: 10px;">
                                <li>Go to Android <strong>Settings → Apps → Obsidian</strong></li>
                                <li>Check if "Camera" permission exists</li>
                                <li>If it doesn't exist, camera access is not available</li>
                                <li>If it exists but is disabled, enable it and restart Obsidian</li>
                            </ol>
                        </details>
                    `;
                } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                    errorMessage += `<p>No camera was detected on your device.</p>`;
                } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                    errorMessage += `<p>The camera is already in use by another application. Please close it and try again.</p>`;
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
        if (!this.settings.geminiApiKey) { new Notice("Gemini API key is not set."); return; }

        const { notebook: selectedNotebook, pageNumber, cancelled } = await this.showNotebookSelectionModal();
        if (cancelled) { return; }

        const isAndroid = /Android/i.test(navigator.userAgent);
        let imageData: ArrayBuffer | null = null;
        let sourceFileName = 'captured-image.jpg';

        if (isAndroid && this.settings.androidCameraMode !== 'gallery') {
            // Try camera first on Android
            imageData = await this.captureFromAndroidCamera();
            
            // If camera failed and mode is 'camera', show helpful message and fall back to gallery
            if (!imageData && this.settings.androidCameraMode === 'camera') {
                new Notice("Camera access failed. Falling back to gallery...");
            }
        }

        // Fall back to file picker if camera didn't work or if gallery mode is selected
        if (!imageData) {
            const file = await new Promise<File | null>((resolve) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                
                // On iOS, still try to use camera capture
                if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                    input.capture = 'environment';
                }
                // On Android with camera mode, try to trigger camera through file picker
                else if (isAndroid && this.settings.androidCameraMode === 'camera') {
                    input.capture = 'environment';
                }
                
                input.style.display = 'none';
                document.body.appendChild(input);
                input.onchange = () => {
                    resolve(input.files ? input.files[0] : null);
                    document.body.removeChild(input);
                };
				input.addEventListener('cancel', () => {
					document.body.removeChild(input);
					resolve(null);
				});
                input.click();
            });

            if (file) {
                imageData = await file.arrayBuffer();
                sourceFileName = file.name;
            }
        }

        if (!imageData) {
            console.log("No image data received, aborting process.");
            return;
        }

        await this.processCapturedImage(imageData, sourceFileName, selectedNotebook, pageNumber);
    }

    async processCapturedImage(imageData: ArrayBuffer, sourceFileName: string, selectedNotebook: Notebook | null, pageNumber: number | null) {
        new Notice("Uploading and processing image...");
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
            
            const noteFilePath = `${noteFolder}/${noteFileName}`;
            
            let noteContent = `![[${imageFile.path}]]\n`;
            if (selectedNotebook && pageNumber) {
                noteContent += `\n> **Notebook:** ${selectedNotebook.name} | **Page:** ${pageNumber}\n`;
            } else if (!selectedNotebook) {
                noteContent += `\n> **Source:** Loose paper / No notebook\n`;
            }
            noteContent += `\n---\n${resultText}\n---`;
            
            const newNoteFile = await this.app.vault.create(noteFilePath, noteContent);
            await this.updateNoteProperties(imageFile, newNoteFile, detectedTags, locationTag, selectedNotebook?.id || null, pageNumber);
            
            this.app.workspace.openLinkText(newNoteFile.path, '', true);
            new Notice("New note created successfully!");

        } catch (error) {
            console.error("Error creating note from image:", error);
            new Notice("Failed to create note. See console.");
        }
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

    parseTasksForObsidianTasks(content: string): Array<{text: string, priority: string, tags: string[], dates?: {[key: string]: string}}> {
        const tasks: Array<{text: string, priority: string, tags: string[], dates?: {[key: string]: string}}> = [];
        const lines = content.split('\n');
        
        console.log(`Parsing tasks from ${lines.length} lines of content`);
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            console.log(`Processing line: "${trimmed}"`);
            
            // Detect priority indicators
            let priority = '';
            let taskText = trimmed;
            let dates: {[key: string]: string} = {};
            
            // Remove bullet points if present
            taskText = taskText.replace(/^[-*•]\s*/, '');
            
            // Check for priority indicators (!, !!, !!!, HIGH, MEDIUM, LOW)
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

    formatTaskForObsidianTasks(task: {text: string, priority: string, tags: string[], dates?: {[key: string]: string}}): string {
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
        
        // Handle "this" patterns
        const thisMatch = normalizedDate.match(/^this\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)$/);
        if (thisMatch) {
            const day = thisMatch[1];
            if (day === 'weekend') {
                const saturday = today.clone().day(6);
                return saturday.format('YYYY-MM-DD');
            }
            const targetDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(day);
            const thisDay = today.clone().day(targetDay);
            return thisDay.format('YYYY-MM-DD');
        }
        
        // Handle "in X days/weeks/months"
        const inMatch = normalizedDate.match(/^in\s+(\d+)\s+(days?|weeks?|months?)$/);
        if (inMatch) {
            const amount = parseInt(inMatch[1]);
            const unit = inMatch[2].replace(/s$/, '');
            return today.clone().add(amount, unit as any).format('YYYY-MM-DD');
        }
        
        // Handle "X days/weeks from now"
        const fromNowMatch = normalizedDate.match(/^(\d+)\s+(days?|weeks?|months?)\s+from\s+(now|today)$/);
        if (fromNowMatch) {
            const amount = parseInt(fromNowMatch[1]);
            const unit = fromNowMatch[2].replace(/s$/, '');
            return today.clone().add(amount, unit as any).format('YYYY-MM-DD');
        }
        
        // Handle specific date patterns like "1st November 2025"
        const ordinalDateMatch = normalizedDate.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?/);
        if (ordinalDateMatch) {
            const day = parseInt(ordinalDateMatch[1]);
            const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
            const monthIndex = monthNames.indexOf(ordinalDateMatch[2]);
            const year = ordinalDateMatch[3] ? parseInt(ordinalDateMatch[3]) : today.year();
            
            const targetDate = today.clone().year(year).month(monthIndex).date(day);
            // If no year specified and date is in the past, assume next year
            if (!ordinalDateMatch[3] && targetDate.isBefore(today, 'day')) {
                targetDate.add(1, 'year');
            }
            return targetDate.format('YYYY-MM-DD');
        }
        
        // Handle month day patterns (e.g., "June 15", "June 15th")
        const monthDayMatch = normalizedDate.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/);
        if (monthDayMatch) {
            const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
            const month = monthDayMatch[1];
            const day = parseInt(monthDayMatch[2]);
            const year = monthDayMatch[3] ? parseInt(monthDayMatch[3]) : today.year();
            const monthIndex = monthNames.indexOf(month);
            const targetDate = today.clone().year(year).month(monthIndex).date(day);
            // If no year specified and date is in the past, assume next year
            if (!monthDayMatch[3] && targetDate.isBefore(today, 'day')) {
                targetDate.add(1, 'year');
            }
            return targetDate.format('YYYY-MM-DD');
        }
        
        // Handle end of time periods
        if (normalizedDate === 'end of week' || normalizedDate === 'eow') {
            return today.clone().endOf('week').format('YYYY-MM-DD');
        }
        if (normalizedDate === 'end of month' || normalizedDate === 'eom') {
            return today.clone().endOf('month').format('YYYY-MM-DD');
        }
        if (normalizedDate === 'end of year' || normalizedDate === 'eoy') {
            return today.clone().endOf('year').format('YYYY-MM-DD');
        }
        
        // Handle day names (assume this week or next week)
        const dayMatch = normalizedDate.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
        if (dayMatch) {
            const targetDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(dayMatch[1]);
            let targetDate = today.clone().day(targetDay);
            // If the day has passed this week, move to next week
            if (targetDate.isBefore(today, 'day')) {
                targetDate.add(1, 'week');
            }
            return targetDate.format('YYYY-MM-DD');
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
        if (!folderPath) { return ""; }
        
        if (!pathTemplate.includes("{notebook}")) {
            folderPath = folderPath.replace(/YYYY/g, window.moment().format("YYYY")).replace(/MM/g, window.moment().format("MM")).replace(/DD/g, window.moment().format("DD"));
        }

        if (!(await this.app.vault.adapter.exists(folderPath))) {
            try { await this.app.vault.createFolder(folderPath); } 
            catch (error) {
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
                let dates: {[key: string]: string} = {};
                
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
                
                // Also check for common date phrases in the task text itself  
                const byMatch = taskText.match(/\bby\s+(tonight|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+\w+|\d{1,2}(?:st|nd|rd|th)?\s+\w+(?:\s+\d{4})?|[\w\s]+?)(?=\s*$|[,.])/i);
                if (byMatch && !dates['due']) {
                    const parsedDate = this.parseNaturalDate(byMatch[1]);
                    if (parsedDate) {
                        dates['due'] = parsedDate;
                        taskText = taskText.replace(byMatch[0], '').trim();
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

        const requestBody = { "contents": [{ "parts": [ { "text": promptText }, { "inline_data": { "mime_type": "image/jpeg", "data": imageBase64 } } ] }] };

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
                } else {
                    // Check if we have the old format (TODOs) and convert it
                    const todosRegex = /### TODOs?\s*\n([\s\S]*?)(?=\n###|$)/;
                    const todosMatch = responseText.match(todosRegex);
                    if (todosMatch && todosMatch[1]) {
                        console.log('Found old TODOs section, converting to Tasks...');
                        const processedTasks = this.processExtractedTasks(todosMatch[1]);
                        responseText = responseText.replace(todosMatch[0], `### Tasks\n${processedTasks}`);
                        
                        // Also remove "Next Actions" section if present
                        const nextActionsRegex = /### Next Actions\s*\n[\s\S]*?(?=\n###|$)/;
                        responseText = responseText.replace(nextActionsRegex, '');
                    }
                }
                
                return responseText;
            } else { throw new Error("Unexpected response structure from Gemini API"); }
        } catch (error) {
            console.error("Gemini API call failed:", error);
            throw error;
        }
    }

    detectTriggerWords(text: string): Array<{trigger: string, content: string, action: TriggerAction}> {
		const triggers: Array<{trigger: string, content: string, action: TriggerAction}> = [];
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

	async processTriggerWithGemini(trigger: {trigger: string, content: string, action: TriggerAction}): Promise<string> {
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
			'organize': `Organize the following content into a clear, logical structure with categories and priorities:\n${trigger.content}`
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
		
		new Setting(containerEl)
			.setName('Gemini Model')
			.setDesc('Select which Gemini model to use for processing')
			.addDropdown(dropdown => dropdown
				.addOption('gemini-2.5-pro', 'Gemini 2.5 Pro (Enhanced reasoning)')
				.addOption('gemini-2.5-flash', 'Gemini 2.5 Flash (Adaptive & cost efficient)')
				.addOption('gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite (High throughput)')
				.addOption('gemini-2.0-flash', 'Gemini 2.0 Flash (Speed & streaming)')
				.addOption('gemini-2.0-flash-lite', 'Gemini 2.0 Flash-Lite (Low latency)')
				.addOption('gemini-1.5-pro', 'Gemini 1.5 Pro (Complex reasoning)')
				.addOption('gemini-1.5-flash', 'Gemini 1.5 Flash (Fast & versatile)')
				.setValue(this.plugin.settings.selectedModel)
				.onChange(async (value) => { 
					this.plugin.settings.selectedModel = value; 
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
		
		// Test button to verify settings work
		new Setting(containerEl)
			.setName('Test Prompt Settings')
			.setDesc('Click to test if prompt settings are working')
			.addButton(button => button
				.setButtonText('Test')
				.onClick(() => {
					new Notice(`Prompt length: ${this.plugin.settings.geminiPrompt?.length || 0} characters`);
				}));
		
		// Reset button in its own setting
		new Setting(containerEl)
			.setName('Reset Prompt')
			.setDesc('Reset the prompt to the default template')
			.addButton(button => button
				.setButtonText('Reset to Default')
				.onClick(async () => {
					// Use the full default prompt inline
					this.plugin.settings.geminiPrompt = `You are an expert note-processing assistant integrated into Obsidian. I am providing you with an image of a handwritten note. 
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
				text: 'Enable/disable specific trigger words. Underline words in your handwritten notes to activate these AI-powered actions - Gemini will detect and process them automatically.', 
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
				text: '💡 How to use: Underline "Tasks" in your handwritten notes, then list tasks below. Use ! for priority (!!! = highest, !! = high, ! = medium).',
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
			text: '💡 Tip: If camera access fails on Android, use Gallery mode. You can take a photo with your camera app first, then select it.',
			cls: 'setting-item-description' 
		});
	}
	
	getTriggerUsageDescription(keyword: string, action: string): string {
		const descriptions: Record<string, string> = {
			'Research': "Deep research on topics you list below the underlined word. Write 'Research' and underline it, then list items below.",
			'Expand': "Expands brief notes into detailed, well-structured content. Underline 'Expand' followed by your brief notes or concept.",
			'Summarize': "Creates concise summaries of your content. Underline 'Summarize' or 'Summarise' above the text to summarize.",
			'Actions': "Extracts and prioritizes all action items with suggested deadlines. Underline 'Actions' above your notes to process.",
			'Tasks': "Adds tasks to your Obsidian Tasks note with priority and tags support. Underline 'Tasks' then list items below (use ! for priority).",
			'Analyze': "Provides critical analysis including pros, cons, risks and opportunities. Underline 'Analyze' or 'Analyse' above content to analyze.",
			'Define': "Provides clear definitions with examples for terms listed below. Underline 'Define' then list terms underneath.",
			'Translate': "Translates content to your specified language. Write and underline 'Translate to [Language]' above the text to translate.",
			'Rewrite': "Rewrites content in a different style (formal, casual, email, etc.). Underline 'Rewrite' and specify the style, then provide content.",
			'Questions': "Generates thought-provoking questions to encourage deeper thinking. Underline 'Questions' above your topic or content.",
			'Connect': "Identifies connections to related concepts and interdisciplinary links. Underline 'Connect' above the concept to explore.",
			'Organize': "Organizes content into clear, logical structure with categories and priorities. Underline 'Organize' or 'Organise' above content to structure."
		};
		
		// Handle spelling variants
		if (keyword === 'Summarise') return descriptions['Summarize'];
		if (keyword === 'Analyse') return descriptions['Analyze'];
		if (keyword === 'Organise') return descriptions['Organize'];
		
		return descriptions[keyword] || 'Process content';
	}
	
	getTriggerDescription(action: string): string {
		const descriptions: Record<string, string> = {
			'research': 'Deep research on listed topics', 'expand': 'Expand brief notes into detailed content', 'summarize': 'Create concise summaries',
			'actions': 'Extract and prioritize action items', 'tasks': 'Add tasks to Obsidian Tasks note', 'analyze': 'Critical analysis with pros/cons', 'define': 'Clear definitions with examples',
			'translate': 'Translate to specified language', 'rewrite': 'Rewrite in different style', 'questions': 'Generate thought-provoking questions',
			'connect': 'Find related concepts and connections', 'organize': 'Organize content into logical structure'
		};
		return descriptions[action] || 'Process content';
	}
}