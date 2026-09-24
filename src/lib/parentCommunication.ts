export interface CommunicationContact {
  student_id: number; student_name: string; academic_year_id: number;
  parent_user_id: number; parent_name: string; staff_user_id: number; staff_name: string; staff_role: string;
}
export interface ParentConversation {
  conversation_key: string; student_id: number; student_name: string;
  parent_name: string; staff_name: string; title: string; status: 'open' | 'closed';
  revision: number; updated_at: number; unread_count: number;
}
export interface ParentMessage {
  id: number; message_key: string; sender_name: string; body: string; created_at: number; mine: boolean;
}
export interface ConversationDetail {
  conversation: ParentConversation; messages: ParentMessage[]; has_more: boolean; can_manage: boolean;
  audit: Array<{ action: string; reason: string | null; revision: number; created_at: number }>;
}
