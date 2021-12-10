import { App, Editor, Modal, Notice, Plugin, PluginSettingTab, Setting, TextComponent, TFile, TFolder } from 'obsidian';
// @ts-ignore - not sure how to build a proper typescript def yet
import * as Mustache from 'mustache';
// @ts-ignore - not sure how to build a proper typescript def yet
import metadataParser from 'markdown-yaml-metadata-parser'
import { BaseModal } from './BaseModal';
import { FillTemplate } from './FillTemplate';
import TemplateHelper, { TemplateField,  TemplateSpec } from './templates';

// Stop mustache from escaping HTML entities as we are generating Markdown
Mustache.escape = function(text:string) {return text;};

/*
 * TODOs:
 * - figure out why textareas are not working qute right
 * - add a replacement string for what goes back into the text
 */

interface FromTemplatePluginSettings {
	templateDirectory: string;
	replaceSelection: boolean;
	inputSplit: string;
	config: string;
}

const DEFAULT_SETTINGS: FromTemplatePluginSettings = {
	templateDirectory: 'templates',
	replaceSelection: true,
	inputSplit: "\\s+-\\s+",
	config: '[]'
}


export interface ReplacementSpec {
	input:string; // The currently selected text in the editor
	template:TemplateSpec;
	editor:Editor;
	fields:TemplateField[]; //Specifications for all of the fields in the template
	data:Record<string,string>; //The data to fill in the template with
	//replacement_text:string;
	createNote:boolean;
	shouldReplaceSelection:boolean;
	willReplaceSelection:boolean;
	replacementText:string;
	openNote:boolean;
}

export default class FromTemplatePlugin extends Plugin {
	settings: FromTemplatePluginSettings;
	templates: TemplateHelper
	//templateDir: string = "templates"

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new FromTemplateSettingTab(this.app, this));
		this.app.workspace.onLayoutReady(() => this.addTemplates());
		this.templates = new TemplateHelper(this.app.vault)
	}

	// Adds all the template commands - calls getTemplates which looks for files in the settings.templateDirectory
	async addTemplates() {
		const templates = await this.getTemplates()
		console.log("Got templates! ",templates)
		templates.forEach(async t => {
			const ts = (await t) as TemplateSpec
			this.addCommand( {
				id:ts.id,
				name: ts.name,
				editorCallback: async (editor, _ ) => { this.launchTemplate(editor,ts) }
				
			});
		})
	}

	async launchTemplate(editor:Editor,ts:TemplateSpec) {
		// Get the template text and the fields to fill in
		const templateText = await this.templates.loadTemplate(ts.name,this.settings.templateDirectory)
		const tempFields = this.templates.templateFields(templateText)
		// Get the input from the editor
		const input = editor.getSelection()
		// ... and populate the field data with it
		const fieldData = this.templates.parseInput(input,ts.inputFieldList,this.settings.inputSplit)
		//This class does all the UI work
		const replacement = {
			input:input,
			template:ts,
			editor:editor,
			fields:tempFields,
			data:fieldData,
			createNote:true,
			openNote:true,
			shouldReplaceSelection:this.settings.replaceSelection,
			willReplaceSelection:this.settings.replaceSelection,
			replacementText:ts.replacement
		}
		new FillTemplate(this.app,this,replacement).open();
	}

	// Run through the settings directory and return an TemplateSettings for each valid file there
	async getTemplates() : Promise<TemplateSpec[]> {
		console.log("Template settings folder: " + this.settings.templateDirectory)
		const templateFolder:TFolder = this.app.vault.getAbstractFileByPath(this.settings.templateDirectory) as TFolder
		if( ! templateFolder ) return []
		return Promise.all( templateFolder.children.map( async c => this.templates.getTemplateSpec(c)) )
	}

	async templateFilled(spec:ReplacementSpec) {
		console.log("Filling template")
		console.log(spec)
		const data = spec.data

		//Copy data across to all the alternative formulations of a field
		spec.fields.forEach( f => {
			f.alternatives.forEach( a => data[a] = data[f.id])
		})
		
		const template = await this.templates.loadTemplate(spec.template.name,this.settings.templateDirectory);
		const result = Mustache.render(template,spec.data);

		if( this.settings.replaceSelection && (spec.template.replacement !== "none") ) {
			const replaceText = Mustache.render(spec.template.replacement,spec.data)
			spec.editor.replaceRange(replaceText,spec.editor.getCursor("from"), spec.editor.getCursor("to"));
		}
		//this.createNote(spec.template.name,spec.template.directory,spec.data['title'],spec.data);
		const filename =spec.template.directory + "/" + spec.data['title'] + ".md" 
		try {
			this.app.vault.create(spec.template.directory + "/" + spec.data['title'] + ".md", result)
		} catch (error) {
			alert("Couldn't create file: \n" + error.toString() )
		}
	}

	

	onunload() {
		console.log('unloading plugin');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}



class FromTemplateSettingTab extends PluginSettingTab {
	plugin: FromTemplatePlugin;

	constructor(app: App, plugin: FromTemplatePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getDirectoryText(folder:string) : [string,string,string] {
		console.log("Checking settings folder: " + folder)
		const templateFolder:TFolder = this.app.vault.getAbstractFileByPath(folder) as TFolder
		if( ! templateFolder ) {
			return [`⚠️ Directory to read templates from. '${folder}' does not exist`,'from-template-error-text','from-template-ok-text']
		}
		else {
			return [`✅ Directory to read templates from. '${folder}' has ${templateFolder.children.length} templates`,'from-template-ok-text','from-template-error-text']
		}
	}

	display(): void {
		let {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Note From Template Settings'});

		/*
		let nameText: TextComponent;
		new Setting(contentEl)
		.setName("Test")
		.setDesc(("Testing stuff?"))
		.addText((text) => {
			nameText = text;
			text.setValue("Hi")
				.onChange((value) => {
					console.log("New text: "+value)
					//this.setValidationError(nameText, "invalid_name");
				});
		});
		*/

		const dirSetting = new Setting(containerEl)
			.setName('Template Directory')
			.setDesc('Directory to read templates from')

		const updateFolderDescription = (folder:string) => {
			try {
			let [text,clss,r_clss] = this.getDirectoryText(folder)
			dirSetting.setDesc(text)
			dirSetting.descEl.addClass(clss)
			dirSetting.descEl.removeClass(r_clss)
			} catch (error) {

			}
		}
		dirSetting.addText(text => text
				.setPlaceholder('templates')
				.setValue(this.plugin.settings.templateDirectory)
				.onChange(async (value) => {
					this.plugin.settings.templateDirectory = value;
					updateFolderDescription(value)
					await this.plugin.saveSettings();
				}));
		updateFolderDescription(this.plugin.settings.templateDirectory)
		new Setting(containerEl)
			.setName('Replace selection')
			.setDesc('Should the current editor selection be replaced with a link to the title of the new Note?')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.replaceSelection)
				.onChange(async (value) => {
					this.plugin.settings.replaceSelection = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Selection split')
			.setDesc('A regex to split up the input selection to fill in extra fields in the note creation box')
			.addText(text => text
				.setValue(this.plugin.settings.inputSplit)
				.onChange(async (value) => {
					this.plugin.settings.inputSplit = value;
					await this.plugin.saveSettings();
				}));

	}
}
