#!/usr/bin/env node

/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const fs = require('fs');
const path = require('path');

// License header templates for different file types
const LICENSE_HEADERS = {
  // JavaScript/Node.js files
  js: `/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

`,
  
  // Shell scripts
  sh: `#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Fernando Rijo Cedeno

`,
  
  // JSON files (as comments aren't standard, we'll skip these)
  json: null,
  
  // Markdown files
  md: `<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2025 Fernando Rijo Cedeno
-->

`,
  
  // Default for text files
  txt: `# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Fernando Rijo Cedeno

`
};

// Files and directories to skip
const SKIP_PATTERNS = [
  'node_modules',
  '.git',
  '.gitignore',
  'package-lock.json',
  'LICENSE',
  'NOTICE',
  '.DS_Store',
  '.env',
  'dist',
  'build',
  'coverage'
];

// File extensions to process
const PROCESS_EXTENSIONS = ['.js', '.sh', '.md', '.txt'];

/**
 * Check if a file already has a license header
 */
function hasLicenseHeader(content) {
  const firstLines = content.split('\n').slice(0, 10).join('\n');
  return firstLines.includes('SPDX-License-Identifier') || 
         firstLines.includes('Copyright 2025 Fernando Rijo Cedeno');
}

/**
 * Get the appropriate license header for a file extension
 */
function getLicenseHeader(ext) {
  switch (ext) {
    case '.js':
      return LICENSE_HEADERS.js;
    case '.sh':
      return LICENSE_HEADERS.sh;
    case '.md':
      return LICENSE_HEADERS.md;
    case '.txt':
      return LICENSE_HEADERS.txt;
    default:
      return LICENSE_HEADERS.txt;
  }
}

/**
 * Check if file should be skipped
 */
function shouldSkipFile(filePath) {
  const basename = path.basename(filePath);
  const dirname = path.dirname(filePath);
  
  return SKIP_PATTERNS.some(pattern => {
    return basename.includes(pattern) || 
           dirname.includes(pattern) ||
           filePath.includes(pattern);
  });
}

/**
 * Process a single file
 */
function processFile(filePath, dryRun = false) {
  try {
    const ext = path.extname(filePath);
    
    // Skip files we don't want to process
    if (!PROCESS_EXTENSIONS.includes(ext) || shouldSkipFile(filePath)) {
      return { skipped: true, reason: 'Extension or pattern match' };
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Skip if already has license header
    if (hasLicenseHeader(content)) {
      return { skipped: true, reason: 'Already has license header' };
    }
    
    const header = getLicenseHeader(ext);
    if (!header) {
      return { skipped: true, reason: 'No header template for extension' };
    }
    
    // In dry run mode, don't actually write the file
    if (dryRun) {
      return { success: true, dryRun: true };
    }
    
    // Handle special cases
    let newContent;
    if (ext === '.sh' && content.startsWith('#!/')) {
      // For shell scripts, preserve shebang and add header after
      const lines = content.split('\n');
      const shebang = lines[0];
      const rest = lines.slice(1).join('\n');
      newContent = shebang + '\n' + LICENSE_HEADERS.sh.replace('#!/bin/bash\n', '') + rest;
    } else if (ext === '.js' && content.startsWith('#!/')) {
      // For Node.js scripts with shebang
      const lines = content.split('\n');
      const shebang = lines[0];
      const rest = lines.slice(1).join('\n');
      newContent = shebang + '\n\n' + header + rest;
    } else {
      newContent = header + content;
    }
    
    fs.writeFileSync(filePath, newContent, 'utf8');
    return { success: true };
    
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Recursively process directory
 */
function processDirectory(dirPath, dryRun = false) {
  const results = {
    processed: [],
    skipped: [],
    errors: []
  };
  
  function walkDir(currentPath) {
    const items = fs.readdirSync(currentPath);
    
    for (const item of items) {
      const itemPath = path.join(currentPath, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isDirectory()) {
        if (!shouldSkipFile(itemPath)) {
          walkDir(itemPath);
        }
      } else if (stat.isFile()) {
        const result = processFile(itemPath, dryRun);
        const relativePath = path.relative(dirPath, itemPath);
        
        if (result.success) {
          results.processed.push(relativePath);
          if (dryRun) {
            console.log(`🔍 Would add license header to: ${relativePath}`);
          } else {
            console.log(`✅ Added license header to: ${relativePath}`);
          }
        } else if (result.skipped) {
          results.skipped.push({ file: relativePath, reason: result.reason });
          console.log(`⏭️  Skipped: ${relativePath} (${result.reason})`);
        } else if (result.error) {
          results.errors.push({ file: relativePath, error: result.error });
          console.error(`❌ Error processing: ${relativePath} - ${result.error}`);
        }
      }
    }
  }
  
  walkDir(dirPath);
  return results;
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  // Filter out flags to get the target path
  const nonFlagArgs = args.filter(arg => !arg.startsWith('--'));
  const targetPath = nonFlagArgs[0] || '.';
  
  console.log('🚀 SPDX License Header Tool');
  console.log('==========================');
  console.log(`Target: ${path.resolve(targetPath)}`);
  console.log(`Dry run: ${dryRun ? 'YES' : 'NO'}`);
  console.log('');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be modified');
    console.log('');
  }
  
  const startTime = Date.now();
  
  if (!fs.existsSync(targetPath)) {
    console.error(`❌ Path does not exist: ${targetPath}`);
    process.exit(1);
  }
  
  const stat = fs.statSync(targetPath);
  let results;
  
  if (stat.isFile()) {
    // Process single file
    const result = processFile(targetPath, dryRun);
    results = {
      processed: result.success ? [targetPath] : [],
      skipped: result.skipped ? [{ file: targetPath, reason: result.reason }] : [],
      errors: result.error ? [{ file: targetPath, error: result.error }] : []
    };
  } else {
    // Process directory
    if (dryRun) {
      console.log('🔍 Would process files with these extensions:', PROCESS_EXTENSIONS.join(', '));
      console.log('📝 Would skip patterns:', SKIP_PATTERNS.join(', '));
      console.log('');
    }
    
    results = processDirectory(targetPath, dryRun);
  }
  
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  console.log('');
  console.log('📊 Summary');
  console.log('==========');
  console.log(`✅ Processed: ${results.processed.length} files`);
  console.log(`⏭️  Skipped: ${results.skipped.length} files`);
  console.log(`❌ Errors: ${results.errors.length} files`);
  console.log(`⏱️  Duration: ${duration}s`);
  
  if (results.errors.length > 0) {
    console.log('');
    console.log('❌ Errors:');
    results.errors.forEach(({ file, error }) => {
      console.log(`  ${file}: ${error}`);
    });
  }
  
  if (dryRun && results.skipped.length === 0 && results.processed.length === 0) {
    console.log('');
    console.log('ℹ️  No files found to process. Run without --dry-run to execute.');
  }
}

// Show usage if --help is passed
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
SPDX License Header Tool

Usage: node add-license-headers.js [path] [options]

Arguments:
  path              Path to file or directory to process (default: current directory)

Options:
  --dry-run         Show what would be processed without making changes
  --help, -h        Show this help message

Examples:
  node add-license-headers.js                    # Process current directory
  node add-license-headers.js src/              # Process src directory
  node add-license-headers.js server.js         # Process single file
  node add-license-headers.js --dry-run         # Preview what would be changed

License Header Format:
  JavaScript: /** SPDX-License-Identifier: Apache-2.0 ... */
  Shell:      # SPDX-License-Identifier: Apache-2.0 ...
  Markdown:   <!-- SPDX-License-Identifier: Apache-2.0 ... -->
  
Skipped Files:
  - node_modules, .git, LICENSE, package-lock.json
  - Files that already have license headers
  - Files with unsupported extensions
  
Copyright: 2025 Fernando Rijo Cedeno
`);
  process.exit(0);
}

// Run the tool
if (require.main === module) {
  main();
}

module.exports = { processFile, processDirectory, hasLicenseHeader };
