const Contact = require("../models/Contact");
const Message = require("../models/Message");

const path = require("path");
const fs = require("fs");

const { getIO } = require("../libs/socket");
const { getWbot, init } = require("../libs/wbot");

const wbotMessageListener = () => {
	const io = getIO();
	const wbot = getWbot();

	wbot.on("message", async msg => {
		console.log(msg);
		let newMessage;
		if (msg.from === "status@broadcast" || msg.type === "location") {
			return;
		}
		try {
			const msgContact = await msg.getContact();
			const profilePicUrl = await msgContact.getProfilePicUrl();
			try {
				let contact = await Contact.findOne({
					where: { number: msgContact.number },
				});

				if (contact) {
					await contact.update({ profilePicUrl: profilePicUrl });
				} else {
					try {
						contact = await Contact.create({
							name: msgContact.pushname || msgContact.number.toString(),
							number: msgContact.number,
							profilePicUrl: profilePicUrl,
						});
					} catch (err) {
						console.log(err);
					}
				}

				if (msg.hasQuotedMsg) {
					const quotedMessage = await msg.getQuotedMessage();
					console.log("quoted", quotedMessage);
				}

				if (msg.hasMedia) {
					const media = await msg.downloadMedia();

					if (media) {
						if (!media.filename) {
							let ext = media.mimetype.split("/")[1].split(";")[0];
							media.filename = `${new Date().getTime()}.${ext}`;
						}

						fs.writeFile(
							path.join(__dirname, "..", "public", media.filename),
							media.data,
							"base64",
							err => {
								console.log(err);
							}
						);

						newMessage = await contact.createMessage({
							id: msg.id.id,
							messageBody: msg.body || media.filename,
							mediaUrl: media.filename,
							mediaType: media.mimetype.split("/")[0],
						});
						await contact.update({ lastMessage: msg.body || media.filename });
					}
				} else {
					newMessage = await contact.createMessage({
						id: msg.id.id,
						messageBody: msg.body,
					});
					await contact.update({ lastMessage: msg.body });
				}

				const serializedMessage = {
					...newMessage.dataValues,
					mediaUrl: `${
						newMessage.mediaUrl
							? `http://${process.env.HOST}:${process.env.PORT}/public/${newMessage.mediaUrl}`
							: ""
					}`,
				};

				const serializaedContact = {
					...contact.dataValues,
					unreadMessages: 1,
					lastMessage: newMessage.messageBody,
				};

				io.to(contact.id).to("notification").emit("appMessage", {
					action: "create",
					message: serializedMessage,
					contact: serializaedContact,
				});

				let chat = await msg.getChat();
				chat.sendSeen();
			} catch (err) {
				console.log(err);
			}
		} catch (err) {
			console.log(err);
		}
	});

	wbot.on("message_ack", async (msg, ack) => {
		try {
			const messageToUpdate = await Message.findOne({
				where: { id: msg.id.id },
			});
			if (!messageToUpdate) {
				// will throw an error is msg wasn't sent from app
				const error = new Error(
					"Erro ao alterar o ack da mensagem no banco de dados"
				);
				error.statusCode = 501;
				throw error;
			}
			await messageToUpdate.update({ ack: ack });

			io.to(messageToUpdate.contactId).emit("appMessage", {
				action: "update",
				message: messageToUpdate,
			});
		} catch (err) {
			console.log(err);
		}
	});
};

module.exports = wbotMessageListener;
