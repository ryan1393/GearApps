import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export const PRINT_AGENT_SCOPE = 'truck-log:print-agent-scope';
export const PrintAgentScope = (scope: string) => SetMetadata(PRINT_AGENT_SCOPE, scope);

export interface AuthenticatedPrintAgent {
  agentId: string;
  displayName: string;
  keyId: string;
  scopes: string[];
}

export interface PrintAgentRequest extends Request {
  printAgent?: AuthenticatedPrintAgent;
}

