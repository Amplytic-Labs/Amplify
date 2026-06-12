---
description: React best practices including hooks, state management, performance optimization, and component architecture
label: React Best Practices
---

# React Best Practices Skill

## Overview
Expert guidance for building robust, performant React applications.

## Component Architecture
- Prefer functional components with hooks over class components
- Keep components small and focused (Single Responsibility Principle)
- Extract reusable logic into custom hooks
- Use composition over inheritance

## State Management
- Use local state (useState) for component-specific data
- Lift state up to the nearest common ancestor when shared
- Use useReducer for complex state logic
- Consider global stores (Zustand, Jotai) for app-wide state

## Performance
- Use React.memo for expensive pure components
- Use useCallback and useMemo to prevent unnecessary re-renders
- Lazy load routes and heavy components with React.lazy
- Use virtualization for long lists (react-window)

## Error Handling
- Implement error boundaries for graceful failure handling
- Use try-catch in async operations
- Provide meaningful error messages to users