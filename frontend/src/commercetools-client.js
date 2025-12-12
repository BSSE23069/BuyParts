// src/commercetools-client.js
import { ClientBuilder } from '@commercetools/sdk-client-v2';
import { createApiBuilderFromCtpClient } from '@commercetools/platform-sdk';

// 1. FILL IN YOUR KEYS HERE
const projectKey = 'shopswift-project'; // From your screenshot
const clientId = 'jvHH9sAoOn-J-90Ocg9jpzC5';
const clientSecret = '79EWq9aPhj3RV-A5HvOW6fz8q6ze8ZZb';
const authUrl = 'https://auth.us-east-2.aws.commercetools.com'; // Check your region URL
const apiUrl = 'https://api.us-east-2.aws.commercetools.com';   // Check your region URL



// 2. Create the Client using the "Builder" pattern
// This automatically sets up the Auth and Http middleware for you
const client = new ClientBuilder()
  .withProjectKey(projectKey)
  .withClientCredentialsFlow({
    host: authUrl,
    projectKey,
    credentials: {
      clientId,
      clientSecret,
    },
    scopes: [`manage_project:${projectKey}`],
    fetch, // Pass the global browser fetch
  })
  .withHttpMiddleware({
    host: apiUrl,
    fetch, // Pass the global browser fetch
  })
  .build();

// 3. Export the API Root
export const apiRoot = createApiBuilderFromCtpClient(client).withProjectKey({ projectKey });