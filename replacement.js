const printf = require('printf');
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const helpers = require('../helpers');
const fs = require("fs");

const fsPromises = require('fs').promises;

function sendEmailReplacement(fileName, session) {
    const mailgun = new Mailgun(formData);

    const messageData = {
        from: 'INFOBOT <no-reply@mg.infobot.pro>',
        to: process.env.DOCS_EMAIL,
        subject: `Документы о замене ПУ абонента ${session.account}`,
        html: `<html>Абонент передал следующие документы по замене установленного ПУ:<br/>
        <p>Номер абонента: ${session.account}</p>
        <p>Номер ввода: ${session.currentCounterNum}</p>
        <p>Действие: замена</p>
        <p>Дата замены: ${session.sendDocsAnswers[0]}</p>
        <p>Показания ПУ на момент демонтажа: ${session.sendDocsAnswers[1]}</p>
        <p>Тип нового ПУ: ${session.sendDocsAnswers[2]}</p>
        <p>Заводской номер нового ПУ: ${session.sendDocsAnswers[3]}</p>
        <p>Показания на момент установки: ${session.sendDocsAnswers[4]}</p>
        <p>Дата поверки нового ПУ: ${session.sendDocsAnswers[5]}</p>
        <p>Текущие показания нового ПУ: ${session.sendDocsAnswers[6]}</p>
        <p>Фото свидетельства о поверке во вложении</p>
        </html>`
    };

    const client = mailgun.client({username: 'api', key: process.env.MAILGUN_KEY || ''});
    fsPromises.readFile(fileName)
        .then((data) => {
            const file = {
                filename: 'docs.jpg',
                data
            };

            messageData.inline = file;
            return client.messages.create(process.env.MAILGUN_DOMAIN, messageData);
        })
        .then((response) => {
            console.log(response);
            fs.unlinkSync(fileName);
        });

}

module.exports = {
    text: async (session, intent, message, logLabel) => {
        return new Promise(async (resolve, reject) => {
            if (message === '') {
                resolve({
                    text: session.phrases.getString('dont_understand') + ' ' + session.phrases.getString(`send_docs_replacement_q${session.sendDocsQuestion}`)
                });
            } else {
                if (session.sendDocsQuestion === 1) {
                    session.sendDocsAnswers = [];
                    const result = /^[0-3]\d\.[0-1]\d\.[1-2]\d\d\d/.test(message);
                    if (!result) {
                        resolve({
                            text: session.phrases.getString('bad_date_format')
                        });
                        return;
                    }
                }

                if (session.sendDocsQuestion !== 8) {
                    session.sendDocsAnswers.push(message);
                    session.sendDocsQuestion++;
                    resolve({
                        text: session.phrases.getString(`send_docs_replacement_q${session.sendDocsQuestion}`)
                    });
                } else {
                    if (message.toLowerCase() === 'нет возможности') {
                        await session.stat.saveVerificationSession(session, 'replacement');
                        const leftCounters = session.countersData.getLeftCounters();
                        if (session.branch === 'meters_data') {
                            if (leftCounters > 0) {
                                session.failCount = 0;
                                session.context = 'input_counter_num';
                                resolve({
                                    text:
                                        [
                                            session.phrases.getString('send_docs_replacement_q8_no'),
                                            printf(session.phrases.getString('left_counters'), `${leftCounters} ${helpers.declOfNum(leftCounters, ['водопроводному вводу', 'водопроводным вводам', 'водопроводным вводам'])}`)
                                        ]
                                });
                            } else {
                                resolve({
                                    isFinal: true,
                                    text: [
                                        session.phrases.getString('send_docs_replacement_q8_no'),
                                        session.phrases.getString('last_counter')
                                    ]
                                });
                            }
                        }
                        if (session.branch === 'send_docs') {
                            if (leftCounters > 0) {
                                session.failCount = 0;
                                session.success = false;
                                session.context = 'send_docs_next_counter';
                                resolve({
                                    text:
                                        [
                                            session.phrases.getString('send_docs_replacement_q8_no'),
                                            printf(session.phrases.getString('send_docs_left_counters'), `${leftCounters} ${helpers.declOfNum(leftCounters, ['водопроводный ввод', 'водопроводных ввода', 'водопроводных вводов'])}`)
                                        ]
                                });
                            } else {
                                session.success = false;
                                resolve({
                                    isFinal: true,
                                    text: [
                                        session.phrases.getString('send_docs_replacement_q8_no'),
                                        session.phrases.getString('send_docs_last_counter')
                                    ]
                                });
                            }
                        }
                    } else {
                        resolve({
                            text: session.phrases.getString('dont_understand') + ' ' + session.phrases.getString(`send_docs_replacement_q${session.sendDocsQuestion}`)
                        });
                    }
                }
            }
        });
    },

    photo: async (session, photoBuffer, logLabel) => {
        return new Promise(async (resolve, reject) => {
            if (session.sendDocsQuestion === 8) {
                fs.writeFileSync(`${session.id}.jpg`, photoBuffer);
                await session.stat.removeVerificationSession(session);
                sendEmailReplacement(`${session.id}.jpg`, session);
                const leftCounters = session.countersData.getLeftCounters();
                if (session.branch === 'meters_data') {
                    if (leftCounters > 0) {
                        session.failCount = 0;
                        session.context = 'input_counter_num';
                        session.errorCode = 0;
                        resolve({
                            text:
                                [
                                    session.phrases.getString('send_docs_verification_ok'),
                                    printf(session.phrases.getString('left_counters'), `${leftCounters} ${helpers.declOfNum(leftCounters, ['водопроводному вводу', 'водопроводным вводам', 'водопроводным вводам'])}`)
                                ]
                        });
                    } else {
                        resolve({
                            isFinal: true,
                            text: [
                                session.phrases.getString('send_docs_verification_ok'),
                                session.phrases.getString('last_counter')
                            ]
                        });
                    }
                }
                if (session.branch === 'send_docs') {
                    if (leftCounters > 0) {
                        session.failCount = 0;
                        session.success = true;
                        session.context = 'send_docs_next_counter';
                        resolve({
                            text:
                                [
                                    session.phrases.getString('send_docs_verification_ok'),
                                    printf(session.phrases.getString('send_docs_left_counters'), `${leftCounters} ${helpers.declOfNum(leftCounters, ['водопроводный ввод', 'водопроводных ввода', 'водопроводных вводов'])}`)
                                ]
                        });
                    } else {
                        session.success = true;
                        resolve({
                            isFinal: true,
                            text: [
                                session.phrases.getString('send_docs_verification_ok'),
                                session.phrases.getString('send_docs_last_counter')
                            ]
                        });
                    }
                }
            } else {
                resolve({
                    text: session.phrases.getString('dont_understand') + ' ' + session.phrases.getString(`send_docs_replacement_q${session.sendDocsQuestion}`)
                });
            }
        });
    }
}
