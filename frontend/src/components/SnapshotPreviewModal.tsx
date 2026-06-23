import { useState } from 'react';
import { X, CheckSquare, Square } from 'lucide-react';
import { apiClient } from '../api/client';
import { useStore } from '../store/useStore';

interface SnapshotPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: any[];
  title?: string;
  sourceMode?: 'tcm' | 'live';
}

export default function SnapshotPreviewModal({ isOpen, onClose, data, title = "Vista Previa de Políticas", sourceMode = 'tcm' }: SnapshotPreviewModalProps) {
  const { fetchTemplates } = useStore();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen || !data) return null;

  const toggleSelection = (index: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    if (selectedIds.size === data.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.map((_, i) => i)));
    }
  };

  const handleSaveSelected = async () => {
    setIsSaving(true);
    let successCount = 0;
    
    for (const index of Array.from(selectedIds)) {
      const raw_res = data[index];
      
      const name = raw_res.displayName || raw_res.name || `Baseline ${index+1}`;
      const description = raw_res.description || `Imported policy`;
      const endpoint_path = raw_res.resourceType || raw_res.endpoint || "deviceManagement/configurationPolicies";
      
      let category = "intune";
      const endpoint_lower = endpoint_path.toLowerCase();
      if (['intents', 'securitybaseline'].some(x => endpoint_lower.includes(x))) category = 'defender';
      else if (['conditionalaccess', 'groups', 'users'].some(x => endpoint_lower.includes(x))) category = 'entra';
      else if (['sensitivitylabels', 'informationprotection'].some(x => endpoint_lower.includes(x))) category = 'purview';
      else if (endpoint_lower.includes('sites')) category = 'sharepoint';

      let sanitized_payload;
      if (sourceMode === 'live' && raw_res.payload) {
        // Live preview already extracts the clean payload inside the "payload" key
        sanitized_payload = { ...raw_res.payload };
      } else {
        // TCM preview has a flat structure
        sanitized_payload = { ...raw_res };
        ['id', 'version', 'createdDateTime', 'lastModifiedDateTime', '@odata.context', '@odata.nextLink', 'resourceType', 'endpoint'].forEach(k => delete sanitized_payload[k]);
      }

      try {
        await apiClient.post('/templates', {
          name,
          description,
          category,
          endpoint: endpoint_path,
          payload: sanitized_payload
        });
        successCount++;
      } catch (err) {
        console.error("Failed to save template", err);
      }
    }
    
    setIsSaving(false);
    alert(`Se han guardado ${successCount} plantillas exitosamente.`);
    await fetchTemplates();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-bg-panel border border-border-color rounded-xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col h-[80vh] animate-in zoom-in-95 duration-200">
        
        <div className="flex items-center justify-between p-4 border-b border-border-color">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-text-primary">{title} ({data.length} ítems)</h2>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-bg-deep border-b border-border-color sticky top-0">
              <tr>
                <th className="px-4 py-3 cursor-pointer" onClick={selectAll}>
                  {selectedIds.size === data.length && data.length > 0 ? <CheckSquare size={16} className="text-accent-blue" /> : <Square size={16} />}
                </th>
                <th className="px-4 py-3 font-semibold">Nombre / Tipo</th>
                <th className="px-4 py-3 font-semibold">Endpoint</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-color">
              {data.map((item, idx) => (
                <tr key={idx} className="hover:bg-bg-deep/50 transition-colors">
                  <td className="px-4 py-3 cursor-pointer" onClick={() => toggleSelection(idx)}>
                    {selectedIds.has(idx) ? <CheckSquare size={16} className="text-accent-blue" /> : <Square size={16} className="text-text-muted" />}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-text-primary">{item.displayName || item.name || `Item ${idx}`}</div>
                    <div className="text-xs text-text-muted mt-0.5">{item.resourceType || (sourceMode === 'live' ? 'Live Endpoint' : 'Unknown')}</div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                    {item.endpoint || item.resourceType || 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-border-color flex justify-between items-center bg-bg-deep">
          <span className="text-sm text-text-secondary">{selectedIds.size} seleccionados</span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              Cerrar
            </button>
            <button
              onClick={handleSaveSelected}
              disabled={isSaving || selectedIds.size === 0}
              className="btn btn-primary px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-lg transition-colors font-medium text-sm disabled:opacity-50 flex items-center gap-2"
            >
              {isSaving ? 'Guardando...' : 'Guardar Seleccionados'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
