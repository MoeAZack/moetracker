// Custom fetch wrapper to safely handle authentication headers and intercept errors
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
  
  // Clone or initialize options
  const options: RequestInit = { ...init };
  
  // Inject authorization header if calling local API
  if (url.includes('/api/')) {
    const key = localStorage.getItem('team_tracker_key');
    if (key) {
      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${key}`);
      options.headers = headers;
    }
  }

  const response = await fetch(input, options);

  // If unauthorized (excluding login endpoint itself), clear session and force reload to login
  if (response.status === 401 && !url.includes('/api/login-key')) {
    localStorage.removeItem('team_tracker_key');
    localStorage.removeItem('team_tracker_role');
    localStorage.removeItem('team_tracker_username');
    // Reload the page so the App transitions cleanly to the Login state
    window.location.reload();
  }

  return response;
}
