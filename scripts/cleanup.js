const { exec } = require('child_process');

// Function to execute shell commands
function executeCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error && error.code !== 1) { // Ignore error code 1 which means no processes found
        console.warn(`Warning: ${error.message}`);
      }
      if (stderr) {
        console.warn(`Warning: ${stderr}`);
      }
      resolve(stdout);
    });
  });
}

async function cleanup() {
  console.log('Cleaning up test processes...');
  
  try {
    // Only kill processes that match our test pattern
    await executeCommand('pkill -f "mocha.*test"');
    
    // Give processes a moment to terminate
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Cleanup completed successfully');
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
}

// Run cleanup
cleanup();
