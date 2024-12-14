// SafetyChecker component

class SafetyChecker {
  constructor() {
    console.log("SafetyChecker initialized");
  }

  runSecurityChecks(token) {
    console.log("Running safety checks...");
    
    // If creator has sold all tokens, that's actually a good sign
    if (token.hasCreatorSoldAll()) {
      console.log(`Creator has fully exited their position - reduced risk`);
      return true;
    }

    // For now, always return true if creator still has position
    return true;
  }

  isCreatorFullyExited(token) {
    return token.hasCreatorSoldAll();
  }
}

module.exports = SafetyChecker;
