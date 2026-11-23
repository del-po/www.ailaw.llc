// Shapes returned by the Blog API (Google Apps Script reading the Drive "Published" folder)

export interface BlogPostSummary {
  slug: string;
  title: string;
  author: string;
  date: string; // yyyy-mm-dd
  category: string;
  deck: string;
  image: string;
  featured: boolean;
  tags: string[];
  readTimeMinutes: number;
  searchText: string;
}

export interface BlogPost extends BlogPostSummary {
  content: string; // HTML, already escaped by the API
}
