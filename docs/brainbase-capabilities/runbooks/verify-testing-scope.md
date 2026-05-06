# Verify Testing Scope

1. If the user gives a test path, run that path first.
2. If no path is given, inspect changed files and find related tests.
3. For implementation files, look for matching unit, integration, and E2E test paths.
4. Run the smallest test set that covers the changed behavior.
5. For UI/runtime behavior, add runtime or browser verification after tests.
