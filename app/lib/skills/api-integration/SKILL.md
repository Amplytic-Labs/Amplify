---
description: API integration patterns including REST, GraphQL, WebSocket connections, and data fetching best practices
label: API Integration
---

# API Integration Skill

## Overview
Best practices for integrating APIs in web applications with proper error handling, caching, and real-time updates.

## REST API Patterns
- Use typed fetch wrappers with proper error handling
- Implement request/response interceptors for auth tokens
- Use abort controllers for cancellable requests
- Implement exponential backoff for retries

## Data Fetching
- Implement proper loading and error states
- Use SWR or React Query for server state management
- Cache responses appropriately
- Implement optimistic updates for better UX

## Real-time Communication
- Use WebSocket for bidirectional real-time data
- Implement reconnection logic with exponential backoff
- Handle message queueing during disconnection
- Use Server-Sent Events for unidirectional real-time updates

## Error Handling
- Classify errors (network, auth, validation, server)
- Show user-friendly error messages
- Implement retry logic for transient failures
- Log errors for debugging