import { X, Code, Copy, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import type { Template } from '../store/useStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  template: Template | null;
}

export default function TemplateDetailsModal({ isOpen, onClose, template }: Props) {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !template) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(template.payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-bg-deep border border-border-color rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-border-color bg-bg-panel flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Code className="text-accent-blue" size={20} />
              Detalles de la Plantilla
            </h2>
            <p className="text-sm text-text-muted mt-1">{template.name}</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-card rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto bg-bg-deep">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-medium text-text-secondary">
              JSON Payload (Enriquecido)
            </div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-bg-card border border-border-color text-text-primary hover:bg-bg-panel transition-colors"
            >
              {copied ? <CheckCircle2 size={14} className="text-success" /> : <Copy size={14} />}
              {copied ? 'Copiado!' : 'Copiar JSON'}
            </button>
          </div>
          <div className="bg-[#1e1e1e] rounded-lg p-4 overflow-x-auto border border-border-color">
            <pre className="text-sm font-mono text-[#d4d4d4]">
              <code>{JSON.stringify(template.payload, null, 2)}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
