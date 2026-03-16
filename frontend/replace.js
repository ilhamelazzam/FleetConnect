const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? 
      walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

const frontendDir = 'c:\\Users\\Microsoft\\Desktop\\flotte_telephonique\\frontend\\src';

walkDir(frontendDir, function(filePath) {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // Remplacer "€" placé AVANT un nombre : "€485" -> "485 MAD", "+€950" -> "+950 MAD"
    content = content.replace(/\+€([\d\s]+)/g, '+$1 MAD');
    content = content.replace(/€([\d\s]+)/g, '$1 MAD');
    
    // Remplacer "€" placé APRES un nombre ou avec "/mois" : "45€" -> "45 MAD", "€55/mois" -> "55 MAD/mois"
    content = content.replace(/([\d\s]+)€/g, '$1 MAD');
    content = content.replace(/€([\d\s]+)\/mois/g, '$1 MAD/mois');
    
    // Remplacer les "€" restants en gardant un espace : "(€)" -> "(MAD)"
    content = content.replace(/€/g, 'MAD');
    
    // Remplacer "+33 6" par "+212 6"
    content = content.replace(/\+33\s/g, '+212 ');

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated ${filePath}`);
    }
  }
});
