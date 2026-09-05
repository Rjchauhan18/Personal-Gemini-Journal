export interface JournalEntry {
  id?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  userId: string;
  summary?: string;
  mood?: string;
  tags?: string[];
  wordCount?: number;
  images?: string[];
}

export interface JournalMessage {
  id?: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  mood?: string;
  images?: string[];
}
