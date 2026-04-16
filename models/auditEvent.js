const mongoose = require('mongoose');

const auditFieldChangeSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        from: { type: mongoose.Schema.Types.Mixed },
        to: { type: mongoose.Schema.Types.Mixed },
    },
    { _id: false }
);

const auditEventSchema = new mongoose.Schema(
    {
        projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
        },
        /** 'project' | 'risk' | 'action' | 'ai' */
        entityType: {
            type: String,
            enum: ['project', 'risk', 'action', 'ai'],
            required: true,
        },
        /**
         * Stable identifier for the entity within the project.
         * For risks/actions this can be a composite like `${projectId}:${index}`.
         */
        entityId: {
            type: String,
            required: true,
        },
        /** Email of the user who performed the action. */
        actorId: {
            type: String,
            required: true,
        },
        /** When this event occurred (server time). */
        timestamp: {
            type: Date,
            default: Date.now,
            required: true,
        },
        /** 'create' | 'update' | 'complete' | 'reopen' | 'delete' */
        action: {
            type: String,
            enum: ['create', 'update', 'complete', 'reopen', 'delete'],
            required: true,
        },
        /**
         * Compact field-level deltas for key properties.
         * Keep this focused on risk level, ownership, and completion rather than full text blobs.
         */
        fields: {
            type: [auditFieldChangeSchema],
            default: undefined,
        },
        /** Optional source hint, e.g. 'ui' | 'ai-suggestion'. */
        source: {
            type: String,
        },
    },
    {
        collection: 'AuditEvents',
    }
);

auditEventSchema.index({ projectId: 1, entityType: 1, timestamp: -1 });

const AuditEvent = mongoose.model('AuditEvent', auditEventSchema);

module.exports = AuditEvent;

