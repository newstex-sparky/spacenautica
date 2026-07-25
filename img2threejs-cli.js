#!/usr/bin/env node

/**
 * img2threejs CLI for Spacenautica
 *
 * Usage: npm run generate-model -- --ref=path/to/image.png --out=src/models/
 *
 * Generates Three.js model components from reference images using img2threejs pattern.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse command line arguments
let refPath = '';
let outDir = 'src/models/';
let type = 'object';

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--ref=')) {
    refPath = arg.split('=')[1];
  } else if (arg.startsWith('--out=')) {
    outDir = arg.split('=')[1];
  } else if (arg.startsWith('--type=')) {
    type = arg.split('=')[1];
  }
}

// Validate input
if (!refPath) {
  console.error('Error: --ref=path/to/reference.png is required');
  process.exit(1);
}

if (!fs.existsSync(refPath)) {
  console.error(`Error: Reference image not found at ${refPath}`);
  process.exit(1);
}

// Ensure output directory exists
const fullOutputPath = path.join(process.cwd(), outDir);
if (!fs.existsSync(fullOutputPath)) {
  fs.mkdirSync(fullOutputPath, { recursive: true });
}

// Generate the model using Python img2threejs scripts
console.log(`Generating ${type} model from ${refPath}...`);

try {
  // Extract reference features from the image
  console.log('Step 1: Extracting reference features...');
  execSync(`python3 ${process.cwd()}/img2threejs/scripts/extract_reference_landmarks.py "${refPath}"`, {
    stdio: 'inherit'
  });

  // Run the sculpt pass orchestrator
  console.log('Step 2: Running sculpt pipeline...');
  execSync(`python3 ${process.cwd()}/img2threejs/scripts/sculpt_pass_orchestrator.py sync asteroid-sculpt-spec.json`, {
    stdio: 'inherit'
  });

  // Generate Three.js factory
  console.log('Step 3: Generating Three.js factory...');
  execSync(`python3 ${process.cwd()}/img2threejs/scripts/generate_threejs_factory.py asteroid-sculpt-spec.json --out src/models/img2threejs/generated.ts`, {
    stdio: 'inherit'
  });

  console.log('✅ Model generation complete!');
  console.log(`Output: ${fullOutputPath}/ModelFactory.ts`);

  // Copy to src/models/
  const srcModelsPath = path.join(process.cwd(), 'src', 'models', 'img2threejs');
  if (!fs.existsSync(srcModelsPath)) {
    fs.mkdirSync(srcModelsPath, { recursive: true });
  }

  const sourceFactory = path.join(process.cwd(), 'img2threejs', 'scripts', 'ModelFactory.ts');
  const targetFactory = path.join(srcModelsPath, 'generated.ts');

  if (fs.existsSync(sourceFactory)) {
    fs.copyFileSync(sourceFactory, targetFactory);
    console.log(`✅ Copied ${targetFactory}`);
  }

  console.log('\nModel generation successful!');
  console.log('Add the generated factory to Factory.ts and update exports.');
} catch (error) {
  console.error('❌ Model generation failed:', error.message);
  process.exit(1);
}