const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.html')) results.push(file);
    }
  });
  return results;
}

const files = walk(process.cwd());
let totalChanged = 0;
let changedFiles = [];

const elRe = /<(p|h[1-6])([^>]*)>([\s\S]*?)<\/\1>/gi;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let newContent = content.replace(elRe, (match, tag, attrs, inner) => {
    const segRe = /(<[^>]+>)|([^<]+)/g;
    const replacedInner = inner.replace(segRe, (m, tagPart, textPart) => {
      if (textPart) {
        return textPart.replace(/\b[^\s<>]*fi[^\s<>]*\b/gi, (word) => {
          return `<span class="lig">${word}</span>`;
        });
      }
      return tagPart;
    });

    return `<${tag}${attrs}>${replacedInner}</${tag}>`;
  });

  if (newContent !== content) {
    fs.writeFileSync(file, newContent, 'utf8');
    totalChanged++;
    changedFiles.push(file);
  }
});

console.log(`Processed ${files.length} HTML files.`);
console.log(`Modified ${totalChanged} files.`);
if (changedFiles.length) console.log('Files changed:\n' + changedFiles.join('\n'));
