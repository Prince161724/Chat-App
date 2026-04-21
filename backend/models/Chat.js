import mongoose from 'mongoose';

const chatSchema = mongoose.Schema(
    {
        from: { type: String, required: true }, // ID or number
        fromName: { type: String, required: true },
        to: { type: String, required: true }, // target ID or number
        toName: { type: String },
        text: { type: String, required: true },
    },
    {
        timestamps: true,
        collection: 'AI-App-Chatting' // The requested collection name
    }
);

const Chat = mongoose.model('Chat', chatSchema);
export default Chat;
