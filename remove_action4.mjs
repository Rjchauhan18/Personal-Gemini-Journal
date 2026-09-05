import fs from 'fs';
let content = fs.readFileSync('src/reflect-prompt.ts', 'utf8');

const act4Start = content.indexOf('ACTION 4: "generate_art_prompt"');
const act5Start = content.indexOf('ACTION 5: "generate_daily_prompts"');

if (act4Start !== -1 && act5Start !== -1) {
  content = content.slice(0, act4Start) + content.slice(act5Start);
  content = content.replace('ACTION 5: "generate_daily_prompts"', 'ACTION 4: "generate_daily_prompts"');
  fs.writeFileSync('src/reflect-prompt.ts', content);
  console.log("Updated reflect-prompt.ts");
} else {
  console.log("Could not find actions");
}
