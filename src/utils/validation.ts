/**
 * Input validation utilities to prevent shell injection attacks
 */

/**
 * Shell metacharacters that could be used for command injection.
 * Also includes space which can cause argument splitting issues.
 */
const SHELL_METACHARACTERS = /[$`;|&<>(){}[\]!"'\\*?\n\r\t#% ]/;

/**
 * Check if a string contains shell metacharacters
 */
export function containsShellMetacharacters(value: string): boolean {
  if (typeof value !== 'string') {
    return true; // Non-strings are invalid
  }
  return SHELL_METACHARACTERS.test(value);
}

/**
 * Validate a Boundary resource ID
 * @param value The ID to validate
 * @param expectedPrefix Optional prefix the ID should start with
 * @returns true if valid, false otherwise
 */
export function validateBoundaryId(value: string, expectedPrefix?: string): boolean {
  if (typeof value !== 'string' || !value) {
    return false;
  }

  // Check for shell metacharacters
  if (containsShellMetacharacters(value)) {
    return false;
  }

  // Check prefix if specified
  if (expectedPrefix && !value.startsWith(expectedPrefix)) {
    return false;
  }

  // Boundary IDs should be alphanumeric with underscores
  // Format: prefix_<alphanumeric chars> or 'global'
  if (value === 'global') {
    return true;
  }

  // Must have a lowercase prefix pattern (letters followed by underscore)
  // e.g., ampw_, amoidc_, ttcp_, tssh_, o_, p_, hcst_, etc.
  const prefixMatch = value.match(/^([a-z]+_)/);
  if (!prefixMatch) {
    return false; // Must have a lowercase prefix
  }

  // Allow alphanumeric and underscore only
  return /^[a-z]+_[a-zA-Z0-9_]+$/.test(value);
}

/**
 * Validate an auth method ID
 */
export function validateAuthMethodId(value: string): boolean {
  if (typeof value !== 'string' || !value) {
    return false;
  }

  // Check for shell metacharacters
  if (containsShellMetacharacters(value)) {
    return false;
  }

  // Must start with valid auth method prefix
  const validPrefixes = ['ampw_', 'amoidc_', 'amldap_'];
  const hasValidPrefix = validPrefixes.some(prefix => value.startsWith(prefix));

  if (!hasValidPrefix) {
    return false;
  }

  // Must be alphanumeric (with underscores allowed) after prefix
  return /^(ampw_|amoidc_|amldap_)[a-zA-Z0-9_]+$/.test(value);
}

/**
 * Validate a target ID
 */
export function validateTargetId(value: string): boolean {
  if (typeof value !== 'string' || !value) {
    return false;
  }

  // Check for shell metacharacters
  if (containsShellMetacharacters(value)) {
    return false;
  }

  // Must start with valid target prefix
  const validPrefixes = ['ttcp_', 'tssh_'];
  const hasValidPrefix = validPrefixes.some(prefix => value.startsWith(prefix));

  if (!hasValidPrefix) {
    return false;
  }

  // Must be alphanumeric (with underscores allowed) after prefix
  return /^(ttcp_|tssh_)[a-zA-Z0-9_]+$/.test(value);
}

/**
 * Validate a scope ID
 */
export function validateScopeId(value: string): boolean {
  if (typeof value !== 'string' || !value) {
    return false;
  }

  // Check for shell metacharacters
  if (containsShellMetacharacters(value)) {
    return false;
  }

  // 'global' is a valid scope
  if (value === 'global') {
    return true;
  }

  // Org and project scopes
  const validPrefixes = ['o_', 'p_'];
  const hasValidPrefix = validPrefixes.some(prefix => value.startsWith(prefix));

  if (!hasValidPrefix) {
    return false;
  }

  // Must be alphanumeric (with underscores allowed) after prefix
  return /^(o_|p_)[a-zA-Z0-9_]+$/.test(value);
}

/**
 * Validate a username for SSH connections
 * More permissive than Boundary IDs but still safe
 */
export function validateUsername(value: string): boolean {
  if (typeof value !== 'string' || !value) {
    return false;
  }

  // Must not contain shell metacharacters
  if (containsShellMetacharacters(value)) {
    return false;
  }

  // Must not contain newlines (SSH config injection)
  if (/[\n\r]/.test(value)) {
    return false;
  }

  // Allow alphanumeric, underscore, hyphen, dot, and @
  // This covers: ubuntu, ec2-user, admin_123, john.doe, user@domain
  return /^[a-zA-Z0-9_.\-@]+$/.test(value);
}

/**
 * Sensitive field names that should be redacted in logs
 */
const SENSITIVE_FIELDS = [
  'password',
  'privateKey',
  'privateKeyPassphrase',
  'token',
  'authorizationToken',
  'secret',
  'apiKey',
  'accessToken',
  'refreshToken',
];

/**
 * Check if a field name is sensitive and should be redacted
 */
function isSensitiveField(fieldName: string): boolean {
  const lowerName = fieldName.toLowerCase();
  return SENSITIVE_FIELDS.some(sensitive =>
    lowerName === sensitive.toLowerCase() ||
    lowerName.endsWith(sensitive.toLowerCase())
  );
}

/**
 * Sanitize an object for logging by redacting sensitive fields
 * @param data The data to sanitize
 * @param seen Set of seen objects to handle circular references
 * @returns A sanitized copy of the data
 */
export function sanitizeForLogging(data: unknown, seen = new WeakSet<object>()): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  // Handle circular references - data is guaranteed to be non-null object here
  // TypeScript narrows 'data' to 'object' after the typeof check, but WeakSet requires object
  if (seen.has(data)) {
    return '[Circular]';
  }
  seen.add(data);

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => sanitizeForLogging(item, seen));
  }

  // Handle objects
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveField(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForLogging(value, seen);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
