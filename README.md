# Obsidian Gemini Note Processor

Process handwritten notes in Obsidian using Google Gemini AI vision capabilities.

<a href="https://buymeacoffee.com/farsonic" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px; width: 217px;" ></a>



## Features
- 📸 Capture handwritten notes via camera or image upload
- 🤖 AI-powered transcription and processing with Google Gemini
- 📝 Automatic task extraction with Obsidian Tasks integration
- 📅 Natural language date parsing
- 📓 Notebook management for organizing physical notebooks
- 🏷️ Smart tagging and organization
- 🎯 Trigger words for advanced AI actions

## Installation

1. Get a Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Install the plugin from Obsidian Community Plugins (coming soon)
3. Enter your API key in settings
4. Start capturing notes!

## Usage

Click the camera icon in the ribbon or right-click an image file to process with Gemini. If you press the camera icon in a desktop instance of Obsidian it will have the user select the image to import. If you are using an IOS device it will go directly to the camera to allow you to take a photo of the page. Android devices is still a work in progress as it looks like Obsidian doesn't request camera access when it is installed. 

## Development
```bash
npm install
npm run dev