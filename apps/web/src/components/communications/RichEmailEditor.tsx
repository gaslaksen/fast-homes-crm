'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import EmojiPicker, { Theme as EmojiTheme } from 'emoji-picker-react';
import 'react-quill-new/dist/quill.snow.css';

// Quill touches `document` at import time, so it must never run on the server.
// Cast to any so we can pass a ref through next/dynamic to the class component.
const ReactQuill = dynamic(() => import('react-quill-new'), {
  ssr: false,
  loading: () => (
    <div className="h-32 flex items-center justify-center text-sm text-gray-400">
      Loading editor…
    </div>
  ),
}) as any;

const TOOLBAR = [
  [{ font: [] }, { size: ['small', false, 'large', 'huge'] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  [{ align: [] }],
  ['link', 'blockquote'],
  ['clean'],
];

export default function RichEmailEditor({
  value,
  onChange,
  placeholder,
  minHeight = 160,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  // react-quill-new forwards a ref to the underlying component whose
  // getEditor() returns the live Quill instance (for cursor emoji insertion).
  const quillRef = useRef<any>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const modules = useMemo(() => ({ toolbar: TOOLBAR }), []);

  // Close the emoji popover on outside click.
  useEffect(() => {
    if (!emojiOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setEmojiOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [emojiOpen]);

  const insertEmoji = (emoji: string) => {
    const editor = quillRef.current?.getEditor?.();
    if (editor) {
      const range = editor.getSelection(true);
      const index = range ? range.index : editor.getLength();
      editor.insertText(index, emoji, 'user');
      editor.setSelection(index + emoji.length, 0);
    } else {
      onChange(`${value || ''}${emoji}`);
    }
    setEmojiOpen(false);
  };

  return (
    <div className="rich-email-editor relative">
      <ReactQuill
        // next/dynamic forwards the ref to react-quill-new (a class component),
        // whose instance exposes getEditor(). If forwarding ever fails, emoji
        // insertion falls back to appending at the end.
        ref={quillRef}
        theme="snow"
        value={value}
        onChange={onChange}
        modules={modules}
        placeholder={placeholder}
      />

      <div className="relative mt-1">
        <button
          type="button"
          onClick={() => setEmojiOpen((o) => !o)}
          className="text-lg leading-none px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          title="Insert emoji"
          aria-label="Insert emoji"
        >
          😊
        </button>
        {emojiOpen && (
          <div ref={pickerRef} className="absolute z-50 bottom-full mb-1 left-0">
            <EmojiPicker
              onEmojiClick={(e) => insertEmoji(e.emoji)}
              theme={EmojiTheme.AUTO}
              width={320}
              height={380}
              lazyLoadEmojis
              previewConfig={{ showPreview: false }}
            />
          </div>
        )}
      </div>

      <style jsx global>{`
        .rich-email-editor .ql-container {
          min-height: ${minHeight}px;
          font-size: 14px;
          border-bottom-left-radius: 0.5rem;
          border-bottom-right-radius: 0.5rem;
        }
        .rich-email-editor .ql-toolbar {
          border-top-left-radius: 0.5rem;
          border-top-right-radius: 0.5rem;
        }
        .rich-email-editor .ql-editor {
          min-height: ${minHeight}px;
        }
        /* Dark mode: keep the editor readable */
        .dark .rich-email-editor .ql-toolbar,
        .dark .rich-email-editor .ql-container {
          border-color: #374151;
        }
        .dark .rich-email-editor .ql-editor {
          color: #e5e7eb;
        }
        .dark .rich-email-editor .ql-editor.ql-blank::before {
          color: #6b7280;
        }
        .dark .rich-email-editor .ql-snow .ql-stroke {
          stroke: #9ca3af;
        }
        .dark .rich-email-editor .ql-snow .ql-fill {
          fill: #9ca3af;
        }
        .dark .rich-email-editor .ql-picker-label {
          color: #9ca3af;
        }
      `}</style>
    </div>
  );
}
