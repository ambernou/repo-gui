const printf = require('printf');
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const moment = require('moment');
const helpers = require('../helpers');
const MVKConnector = require('../libs/mvk-connector');

const fs = require("fs");
const S3Uploader = require("../S3Uploader");
const {v4: uuidv4} = require("uuid");
const fsPromises = require('fs').promises;

async function sendAISReplacement(fileName, session) {
    await S3Uploader(fileName, `replacement-verification-docs`);

    await MVKConnector.sendReplacementData({
        "abo": session.account.toString(),
        "numku": session.currentCounterNum.toString(),
        "date_replace": session.sendDocsAnswers[0],
        "readings_remove": parseInt(session.sendDocsAnswers[1]),
        "readings_check": parseInt(session.sendDocsAnswers[4]),
        "readings_current": parseInt(session.sendDocsAnswers[6]),
        "date_check": session.sendDocsAnswers[5],
        "pu_num": session.sendDocsAnswers[3].toString(),
        "photo_url": `${process.env.DOCS_URL_PREFIX}${fileName}`
    }, session);
}


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
                if (session.sendDocsQuestion === 1 || session.sendDocsQuestion === 6) {
                    if (session.sendDocsQuestion === 1) {
                        session.sendDocsAnswers = [];
                    }
                    const replacementDate = moment(message, 'DD-MM-YYYY');
                    const dateIsOk = /^[0-3]\d\.[0-1]\d\.[1-2]\d\d\d/.test(message);
                    if (!replacementDate.isValid() || !dateIsOk || replacementDate.isAfter(moment())) {
                        resolve({
                            text: session.phrases.getString('bad_date_format')
                        });
                        return;
                    } else {
                        message = replacementDate.format('YYYY-MM-DD');
                    }
                }

                if (session.sendDocsQuestion !== 8) {
                    session.sendDocsAnswers.push(message);
                    session.sendDocsQuestion++;
                    if (session.sendDocsQuestion === 3) {
                        session.sendDocsAnswers.push(null);
                        session.sendDocsQuestion++;
                    }
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
                const fileName = `${uuidv4()}.jpg`
                fs.writeFileSync(fileName, photoBuffer);
                await session.stat.removeVerificationSession(session);
                //sendEmailReplacement(fileName, session);
                await sendAISReplacement(fileName, session);
                fs.unlinkSync(fileName);

                session.context = 'input_counter_num';
                session.errorCode = 0;
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
