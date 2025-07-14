import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('IL-ML Language Support is now active');
    
    const foldingProvider = vscode.languages.registerFoldingRangeProvider(
        { language: 'il-ml' },
        new ILMLFoldingProvider()
    );
    
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        { language: 'il-ml' },
        new ILMLCompletionProvider(),
        '/', '#', '@', '$', '<', '!', '+', '-', '~', '>'
    );
    
    const documentFormatter = vscode.languages.registerDocumentFormattingEditProvider(
        { language: 'il-ml' },
        new ILMLDocumentFormattingEditProvider()
    );
    
    context.subscriptions.push(foldingProvider, completionProvider, documentFormatter);
}

export function deactivate() { }

function getIndentation(line: string): number {
    const match = line.match(/^\s*/);
    return match ? match[0].length : 0;
}

interface FoldingRegion {
    line: number;
    indentation: number;
    type: 'explicit-block' | 'sub-block' | 'template' | 'block-comment' | 'code-block';
    name?: string;
}

class ILMLFoldingProvider implements vscode.FoldingRangeProvider {
    provideFoldingRanges(
        document: vscode.TextDocument,
        context: vscode.FoldingContext,
        token: vscode.CancellationToken
    ): vscode.FoldingRange[] {
        const ranges: vscode.FoldingRange[] = [];
        const regionStack: FoldingRegion[] = [];

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            
            if (line.isEmptyOrWhitespace) continue;

            const text = line.text;
            const trimmedText = text.trim();
            const currentIndentation = getIndentation(text);
            
            // Block comment handling
            const blockCommentStart = trimmedText.startsWith('/*');
            const blockCommentEnd = trimmedText.endsWith('*/') || trimmedText === '*/';
            
            // Code block handling
            const codeBlockMarker = trimmedText.startsWith('```');
            
            // Explicit block boundaries
            const isExplicitBlockStart = /^\s*\/# \s*([A-Z]+):\s*(.*)$/.test(text);
            const isExplicitBlockEnd = /^\s*#\/\s*$/.test(text);
            
            // Sub-blocks
            const isSubBlock = /^\s*##\s+/.test(text);
            
            // Template boundaries
            const templateStartMatch = trimmedText.match(/^<([A-Za-z][A-Za-z0-9_]*)>$/);
            const templateEndMatch = trimmedText.match(/^<\/([A-Za-z][A-Za-z0-9_]*)>$/);
            
            // Handle end markers
            if (blockCommentEnd && !blockCommentStart) {
                this.closeRegionOfType(regionStack, ranges, 'block-comment', i);
                continue;
            }
            
            if (codeBlockMarker) {
                const existingCodeBlock = this.findRegionOfType(regionStack, 'code-block');
                if (existingCodeBlock) {
                    this.closeRegionOfType(regionStack, ranges, 'code-block', i);
                } else {
                    regionStack.push({
                        line: i,
                        indentation: currentIndentation,
                        type: 'code-block'
                    });
                }
                continue;
            }
            
            if (isExplicitBlockEnd) {
                this.closeRegionOfType(regionStack, ranges, 'explicit-block', i);
                continue;
            }
            
            if (templateEndMatch) {
                const templateName = templateEndMatch[1];
                this.closeTemplateRegion(regionStack, ranges, templateName, i);
                continue;
            }
            
            // Handle sub-blocks (close previous sub-blocks of same or greater indentation)
            if (isSubBlock) {
                this.closeSubBlocksAtIndentation(regionStack, ranges, currentIndentation, i - 1);
                regionStack.push({ 
                    line: i, 
                    indentation: currentIndentation, 
                    type: 'sub-block'
                });
                continue;
            }
            
            // Handle start markers
            if (blockCommentStart && !blockCommentEnd) {
                regionStack.push({
                    line: i,
                    indentation: currentIndentation,
                    type: 'block-comment'
                });
            } else if (templateStartMatch) {
                const templateName = templateStartMatch[1];
                regionStack.push({
                    line: i,
                    indentation: currentIndentation,
                    type: 'template',
                    name: templateName
                });
            } else if (isExplicitBlockStart) {
                regionStack.push({
                    line: i,
                    indentation: currentIndentation,
                    type: 'explicit-block'
                });
            }
        }

        // Close remaining regions
        const lastLine = document.lineCount - 1;
        this.closeRemainingRegions(regionStack, ranges, lastLine);

        return ranges;
    }

    private closeRegionOfType(regionStack: FoldingRegion[], ranges: vscode.FoldingRange[], type: string, endLine: number) {
        for (let j = regionStack.length - 1; j >= 0; j--) {
            if (regionStack[j].type === type) {
                const region = regionStack.splice(j, 1)[0];
                if (endLine > region.line) {
                    ranges.push(new vscode.FoldingRange(region.line, endLine));
                }
                break;
            }
        }
    }

    private closeTemplateRegion(regionStack: FoldingRegion[], ranges: vscode.FoldingRange[], templateName: string, endLine: number) {
        for (let j = regionStack.length - 1; j >= 0; j--) {
            if (regionStack[j].type === 'template' && regionStack[j].name === templateName) {
                const region = regionStack.splice(j, 1)[0];
                if (endLine > region.line) {
                    ranges.push(new vscode.FoldingRange(region.line, endLine));
                }
                break;
            }
        }
    }

    private findRegionOfType(regionStack: FoldingRegion[], type: string): FoldingRegion | undefined {
        for (let i = regionStack.length - 1; i >= 0; i--) {
            if (regionStack[i].type === type) {
                return regionStack[i];
            }
        }
        return undefined;
    }

    private closeSubBlocksAtIndentation(regionStack: FoldingRegion[], ranges: vscode.FoldingRange[], currentIndentation: number, beforeLine: number) {
        while (regionStack.length > 0) {
            const topRegion = regionStack[regionStack.length - 1];
            
            if (topRegion.type !== 'sub-block') break;
            
            if (currentIndentation <= topRegion.indentation) {
                const region = regionStack.pop()!;
                const endLine = this.findLastNonEmptyLine(beforeLine);
                if (endLine > region.line) {
                    ranges.push(new vscode.FoldingRange(region.line, endLine));
                }
            } else {
                break;
            }
        }
    }

    private closeRemainingRegions(regionStack: FoldingRegion[], ranges: vscode.FoldingRange[], lastLine: number) {
        while (regionStack.length > 0) {
            const region = regionStack.pop()!;
            if (['sub-block', 'template'].includes(region.type) && lastLine > region.line) {
                ranges.push(new vscode.FoldingRange(region.line, lastLine));
            }
        }
    }

    private findLastNonEmptyLine(beforeLine: number): number {
        return Math.max(0, beforeLine);
    }
}

class ILMLCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        
        // Block type completion
        if (linePrefix.match(/^\s*\/# \s*$/)) {
            const blockTypes = [
                { type: 'DIRECTIVE', desc: 'Operational Guidelines, the foundational instruction set' },
                { type: 'PROCESS', desc: 'Workflow or resolution guidelines' },
                { type: 'QUERY', desc: 'Module for analyzing and extracting specific data from TURN' },
                { type: 'INSIGHT', desc: 'Module that applies interpretative constraints on TURN' },
                { type: 'CANON', desc: 'Module that applies or enforces constraints on response' },
                { type: 'DAEMON', desc: 'Persona definition for council representatives' },
                { type: 'ENGRAM', desc: 'Data store for simulation state recall' }
            ];

            return blockTypes.map(block => {
                const item = new vscode.CompletionItem(
                    `${block.type}:`,
                    vscode.CompletionItemKind.Class
                );
                item.detail = block.desc;
                item.insertText = new vscode.SnippetString(`${block.type}: $1\n  $0\n#/`);
                return item;
            });
        }

        // Metadata completion
        if (linePrefix.match(/^\s*@$/)) {
            const metadata = [
                'priority', 'group', 'member', 'index', 'type', 'access'
            ];
            
            return metadata.map(meta => {
                const item = new vscode.CompletionItem(meta, vscode.CompletionItemKind.Property);
                item.insertText = new vscode.SnippetString(`${meta}: $1`);
                return item;
            });
        }

        // Template completion
        if (linePrefix.match(/^\s*<[A-Za-z]*$/)) {
            const templates = [
                'CouncilTemplate', 'NarrativeTemplate', 'TemporalTemplate', 'ModuleDiagnostic'
            ];
            
            return templates.map(template => {
                const item = new vscode.CompletionItem(template, vscode.CompletionItemKind.Snippet);
                item.insertText = new vscode.SnippetString(`${template}>\n  $0\n</${template}>`);
                return item;
            });
        }

        // Variable output completion
        if (linePrefix.match(/^\s*>>$/)) {
            const item = new vscode.CompletionItem('$variable', vscode.CompletionItemKind.Variable);
            item.insertText = new vscode.SnippetString(' $$1 $2');
            item.detail = 'Output variable declaration';
            return [item];
        }

        return [];
    }
}

class ILMLDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        const edits: vscode.TextEdit[] = [];
        let insideBlock = false;
        let blockIndentation = 0;
        let templateStack: Array<{ name: string, indentation: number }> = [];

        const tabSize = options.insertSpaces ? options.tabSize : 1;
        const indentChar = options.insertSpaces ? ' ' : '\t';

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const text = line.text;
            const trimmedText = text.trim();

            if (line.isEmptyOrWhitespace || trimmedText.startsWith('//') || trimmedText.startsWith('/*')) {
                continue;
            }

            // Block boundaries
            const blockStartMatch = text.match(/^(\s*)\/# \s*([A-Z]+):\s*(.*)$/);
            const isBlockEnd = trimmedText === '#/';
            const templateStartMatch = trimmedText.match(/^<([A-Za-z][A-Za-z0-9_]*)>$/);
            const templateEndMatch = trimmedText.match(/^<\/([A-Za-z][A-Za-z0-9_]*)>$/);

            if (blockStartMatch) {
                insideBlock = true;
                blockIndentation = blockStartMatch[1].length;
                const formattedLine = `${blockStartMatch[1]}/# ${blockStartMatch[2]}: ${blockStartMatch[3]}`;
                if (text !== formattedLine) {
                    edits.push(vscode.TextEdit.replace(line.range, formattedLine));
                }
                continue;
            }

            if (isBlockEnd) {
                insideBlock = false;
                const expectedIndentation = indentChar.repeat(blockIndentation);
                const formattedLine = `${expectedIndentation}#/`;
                if (text !== formattedLine) {
                    edits.push(vscode.TextEdit.replace(line.range, formattedLine));
                }
                continue;
            }

            if (templateStartMatch) {
                const templateName = templateStartMatch[1];
                const currentIndent = getIndentation(text);
                
                let expectedIndentation = currentIndent;
                if (insideBlock) {
                    expectedIndentation = blockIndentation + tabSize;
                } else if (templateStack.length > 0) {
                    expectedIndentation = templateStack[templateStack.length - 1].indentation + tabSize;
                }
                
                const formattedLine = `${indentChar.repeat(expectedIndentation)}<${templateName}>`;
                if (text !== formattedLine) {
                    edits.push(vscode.TextEdit.replace(line.range, formattedLine));
                }
                
                templateStack.push({ name: templateName, indentation: expectedIndentation });
                continue;
            }

            if (templateEndMatch) {
                const templateName = templateEndMatch[1];
                const matchingTemplate = templateStack.find(t => t.name === templateName);
                if (matchingTemplate) {
                    templateStack = templateStack.filter(t => t.name !== templateName);
                    const formattedLine = `${indentChar.repeat(matchingTemplate.indentation)}</${templateName}>`;
                    if (text !== formattedLine) {
                        edits.push(vscode.TextEdit.replace(line.range, formattedLine));
                    }
                }
                continue;
            }

            // Format content inside structures
            const insideTemplate = templateStack.length > 0;
            
            if (insideBlock || insideTemplate) {
                let baseIndentation = 0;
                
                if (insideBlock && insideTemplate) {
                    const topTemplate = templateStack[templateStack.length - 1];
                    baseIndentation = topTemplate.indentation + tabSize;
                } else if (insideBlock) {
                    baseIndentation = blockIndentation + tabSize;
                } else if (insideTemplate) {
                    const topTemplate = templateStack[templateStack.length - 1];
                    baseIndentation = topTemplate.indentation + tabSize;
                }
                
                // Format directives and special lines
                if (/^\s*[!@+\-~<<>>]/.test(trimmedText) || /^\s*##/.test(trimmedText)) {
                    const expectedIndentation = indentChar.repeat(baseIndentation);
                    const formattedLine = `${expectedIndentation}${trimmedText}`;
                    if (text !== formattedLine) {
                        edits.push(vscode.TextEdit.replace(line.range, formattedLine));
                    }
                } else if (trimmedText && !text.startsWith(indentChar.repeat(baseIndentation))) {
                    const expectedIndentation = indentChar.repeat(baseIndentation);
                    const formattedLine = `${expectedIndentation}${trimmedText}`;
                    edits.push(vscode.TextEdit.replace(line.range, formattedLine));
                }
            }
        }

        return edits;
    }
}