import os
import re

frontend_dir = 'c:\\Users\\Microsoft\\Desktop\\flotte_telephonique\\frontend\\src'

def process_file(filepath):
    if not (filepath.endswith('.tsx') or filepath.endswith('.ts') or filepath.endswith('.md')):
        return
        
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    
    # +€950 -> +950 MAD
    content = re.sub(r'\+€([\d\s]+)', r'+\1 MAD', content)
    # €485 -> 485 MAD
    content = re.sub(r'€([\d\s]+)', r'\1 MAD', content)
    
    # 55€ -> 55 MAD
    content = re.sub(r'([\d\s]+)€', r'\1 MAD', content)
    
    # Remplacer les € restants
    content = content.replace('€', 'MAD')
    
    # Remplacer les numerots +33
    content = content.replace('+33 ', '+212 ')

    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated {filepath}")

for root, dirs, files in os.walk(frontend_dir):
    for file in files:
        process_file(os.path.join(root, file))
