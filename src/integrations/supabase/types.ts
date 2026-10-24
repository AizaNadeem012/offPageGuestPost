export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      activity_logs: {
        Row: {
          campaign_id: string | null;
          created_at: string;
          id: string;
          level: string;
          message: string;
          website_id: string | null;
        };
        Insert: {
          campaign_id?: string | null;
          created_at?: string;
          id?: string;
          level?: string;
          message: string;
          website_id?: string | null;
        };
        Update: {
          campaign_id?: string | null;
          created_at?: string;
          id?: string;
          level?: string;
          message?: string;
          website_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "activity_logs_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_logs_website_id_fkey";
            columns: ["website_id"];
            isOneToOne: false;
            referencedRelation: "websites";
            referencedColumns: ["id"];
          },
        ];
      };
      article_revisions: {
        Row: {
          article_id: string;
          content: string;
          created_at: string;
          id: string;
          note: string | null;
          title: string;
          version: number;
        };
        Insert: {
          article_id: string;
          content: string;
          created_at?: string;
          id?: string;
          note?: string | null;
          title: string;
          version: number;
        };
        Update: {
          article_id?: string;
          content?: string;
          created_at?: string;
          id?: string;
          note?: string | null;
          title?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "article_revisions_article_id_fkey";
            columns: ["article_id"];
            isOneToOne: false;
            referencedRelation: "articles";
            referencedColumns: ["id"];
          },
        ];
      };
      articles: {
        Row: {
          anchor_text: string | null;
          campaign_id: string;
          content: string;
          created_at: string;
          id: string;
          status: string;
          target_url: string | null;
          title: string;
          updated_at: string;
          version: number;
          website_id: string;
          word_count: number;
        };
        Insert: {
          anchor_text?: string | null;
          campaign_id: string;
          content: string;
          created_at?: string;
          id?: string;
          status?: string;
          target_url?: string | null;
          title: string;
          updated_at?: string;
          version?: number;
          website_id: string;
          word_count?: number;
        };
        Update: {
          anchor_text?: string | null;
          campaign_id?: string;
          content?: string;
          created_at?: string;
          id?: string;
          status?: string;
          target_url?: string | null;
          title?: string;
          updated_at?: string;
          version?: number;
          website_id?: string;
          word_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "articles_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "articles_website_id_fkey";
            columns: ["website_id"];
            isOneToOne: false;
            referencedRelation: "websites";
            referencedColumns: ["id"];
          },
        ];
      };
      campaigns: {
        Row: {
          config: Json;
          created_at: string;
          id: string;
          missing_info: Json;
          name: string;
          prompt: string;
          source_filename: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          config?: Json;
          created_at?: string;
          id?: string;
          missing_info?: Json;
          name?: string;
          prompt: string;
          source_filename?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          config?: Json;
          created_at?: string;
          id?: string;
          missing_info?: Json;
          name?: string;
          prompt?: string;
          source_filename?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      outreach_templates: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          name: string;
          subject: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          name: string;
          subject: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          name?: string;
          subject?: string;
        };
        Relationships: [];
      };
      gmail_connections: {
        Row: {
          connected_at: string;
          email: string;
          id: string;
          refresh_token_ciphertext: string;
          refresh_token_iv: string;
          refresh_token_tag: string;
        };
        Insert: {
          connected_at?: string;
          email: string;
          id?: string;
          refresh_token_ciphertext: string;
          refresh_token_iv: string;
          refresh_token_tag: string;
        };
        Update: {
          connected_at?: string;
          email?: string;
          id?: string;
          refresh_token_ciphertext?: string;
          refresh_token_iv?: string;
          refresh_token_tag?: string;
        };
        Relationships: [];
      };
      publisher_allowlist: {
        Row: {
          approved_at: string;
          domain: string;
          enabled: boolean;
        };
        Insert: {
          approved_at?: string;
          domain: string;
          enabled?: boolean;
        };
        Update: {
          approved_at?: string;
          domain?: string;
          enabled?: boolean;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          data: Json;
          id: number;
        };
        Insert: {
          data?: Json;
          id?: number;
        };
        Update: {
          data?: Json;
          id?: number;
        };
        Relationships: [];
      };
      websites: {
        Row: {
          attempts: number;
          article_content: string | null;
          article_title: string | null;
          campaign_id: string;
          category: string | null;
          created_at: string;
          discovery: Json;
          domain: string;
          id: string;
          last_error: string | null;
          locked_at: string | null;
          login_url: string | null;
          notes: string | null;
          preferred_anchor: string | null;
          priority: number;
          publication_url: string | null;
          stage: string;
          status: string;
          submission_package: Json | null;
          submitted_at: string | null;
          target_url: string | null;
          updated_at: string;
          url: string;
          verification: Json | null;
          verified_at: string | null;
        };
        Insert: {
          attempts?: number;
          article_content?: string | null;
          article_title?: string | null;
          campaign_id: string;
          category?: string | null;
          created_at?: string;
          discovery?: Json;
          domain: string;
          id?: string;
          last_error?: string | null;
          locked_at?: string | null;
          login_url?: string | null;
          notes?: string | null;
          preferred_anchor?: string | null;
          priority?: number;
          publication_url?: string | null;
          stage?: string;
          status?: string;
          submission_package?: Json | null;
          submitted_at?: string | null;
          target_url?: string | null;
          updated_at?: string;
          url: string;
          verification?: Json | null;
          verified_at?: string | null;
        };
        Update: {
          attempts?: number;
          article_content?: string | null;
          article_title?: string | null;
          campaign_id?: string;
          category?: string | null;
          created_at?: string;
          discovery?: Json;
          domain?: string;
          id?: string;
          last_error?: string | null;
          locked_at?: string | null;
          login_url?: string | null;
          notes?: string | null;
          preferred_anchor?: string | null;
          priority?: number;
          publication_url?: string | null;
          stage?: string;
          status?: string;
          submission_package?: Json | null;
          submitted_at?: string | null;
          target_url?: string | null;
          updated_at?: string;
          url?: string;
          verification?: Json | null;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "websites_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
