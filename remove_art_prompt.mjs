import fs from 'fs';
let content = fs.readFileSync('src/components/JournalChat.tsx', 'utf8');

// Remove state variables
content = content.replace("  const [artPrompt, setArtPrompt] = useState<string | null>(null);\n", "");
content = content.replace("  const [generatedImage, setGeneratedImage] = useState<string | null>(null);\n", "");
content = content.replace("  const [isGeneratingImage, setIsGeneratingImage] = useState(false);\n", "");
content = content.replace("  const [isGeneratingArt, setIsGeneratingArt] = useState(false);\n", "");

// Remove handleGenerateArtPrompt
const handleGenStart = content.indexOf("  const handleGenerateArtPrompt = async () => {");
if (handleGenStart !== -1) {
  const handleGenEnd = content.indexOf("  const handleGenerateDailyPrompts = async () => {");
  if (handleGenEnd !== -1) {
    content = content.slice(0, handleGenStart) + content.slice(handleGenEnd);
  }
}

// Remove button
const buttonPattern = /<button[\s\S]*?onClick=\{handleGenerateArtPrompt\}[\s\S]*?<\/button>/;
content = content.replace(buttonPattern, "");

// Remove modal
const modalPattern = /\{artPrompt && \([\s\S]*?<\/AnimatePresence>\s*<AnimatePresence>/;
content = content.replace(modalPattern, "<AnimatePresence>");

fs.writeFileSync('src/components/JournalChat.tsx', content);
