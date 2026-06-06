const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '..', 'thesis', 'index.html');
const backupPath = filePath + '.bak.' + Date.now();

try {
  fs.copyFileSync(filePath, backupPath);
  console.log('Backup created:', backupPath);
} catch (e) {
  console.error('Backup failed:', e.message);
  process.exit(1);
}

let s = fs.readFileSync(filePath, 'utf8');

// 1) Convert any class attributes that contain c6 into class="italic"
s = s.replace(/class="([^"]*\bc6\b[^"]*)"/g, 'class="italic"');

// 2) Remove all remaining class attributes
s = s.replace(/\sclass="[^"]*"/g, '');

// 3) Remove inline style attributes
s = s.replace(/\sstyle="[^"]*"/g, '');

// 4) Remove empty spans (including those containing only &nbsp;)
s = s.replace(/<span>\s*(?:&nbsp;|&#160;)?\s*<\/span>/g, '');

// 5) Unwrap all <span>...</span> by replacing with their innerHTML
//    This preserves contents like <a>, <img>, <strong>, etc.
s = s.replace(/<span([^>]*)>([\s\S]*?)<\/span>/g, function (_, attrs, inner) {
  // If span has attributes (other than style/class which were removed), keep it
  if (attrs && attrs.trim()) return `<span${attrs}>${inner}</span>`;
  return inner;
});

// 6) Remove empty paragraphs that may have become empty: <p>\s*</p>
s = s.replace(/<p>\s*<\/p>/g, '');

// 7) Collapse many blank lines
s = s.replace(/\n{3,}/g, '\n\n');

fs.writeFileSync(filePath, s, 'utf8');
console.log('Cleaned file written to', filePath);
