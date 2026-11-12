type Guide = {
  title: string;
  description: string;
  intro: string;
  sections: { title: string; text: string }[];
};
export const guides: Record<string, Guide> = {
  "organizar-contas-do-casal": {
    title: "Como organizar as contas do casal",
    description:
      "Um passo a passo para combinar responsabilidades, registrar gastos e acompanhar as contas do casal ao longo do mês.",
    intro:
      "Organizar as contas começa com um combinado que as duas pessoas entendam. Antes de escolher uma ferramenta, decidam quais despesas fazem parte da rotina compartilhada e como vão acompanhá-las.",
    sections: [
      {
        title: "1. Façam uma lista do que é compartilhado",
        text: "Aluguel, energia, internet e mercado são exemplos. Definam também quais gastos continuam individuais e evitem deixar essa decisão implícita. O acordo pode mudar ao longo do tempo.",
      },
      {
        title: "2. Combinem as responsabilidades",
        text: "Vocês podem dividir igualmente ou considerar a renda e as condições de cada um. Por exemplo, com rendas de R$ 3.000 e R$ 2.000, uma divisão proporcional corresponde a 60% e 40%. Para R$ 2.000 em contas comuns, seriam R$ 1.200 e R$ 800. Isso é apenas um exemplo de acordo, não uma regra para todos os casais.",
      },
      {
        title: "3. Separem previsto de pago",
        text: "Uma conta lançada não significa uma conta quitada. Registrem o vencimento e confirmem o pagamento quando acontecer. Identificar quem pagou evita confusão quando a pessoa responsável pela despesa é outra.",
      },
      {
        title: "4. Reservem alguns minutos na semana",
        text: "Confiram contas próximas, despesas que ainda não entraram e parcelas futuras. A ideia é corrigir o mês enquanto ele acontece, em vez de descobrir tudo quando o dinheiro acabar.",
      },
      {
        title: "Como o Nossa Conta ajuda",
        text: "No Nossa Conta, vocês registram receitas e despesas, identificam responsáveis e pagadores e acompanham o saldo previsto. Cada pessoa entra com sua conta no mesmo espaço. Os combinados de divisão são de vocês; não é necessário movimentar dinheiro pelo aplicativo.",
      },
    ],
  },
  "controlar-compras-parceladas": {
    title: "Como controlar compras parceladas sem perder a visão do mês",
    description:
      "Veja como registrar parcelas, evitar contar valores duas vezes e acompanhar compromissos dos próximos meses.",
    intro:
      "A parcela cabe no mês da compra, mas também precisa caber nos meses seguintes. Para enxergar isso, o controle precisa registrar tanto o compromisso futuro quanto o que já foi pago.",
    sections: [
      {
        title: "Registre valor, quantidade e início",
        text: "Uma compra de R$ 1.200 em 6 parcelas de R$ 200 compromete seis meses. Anote a primeira data de pagamento e a quantidade total. Se houver juros, use o total efetivamente contratado.",
      },
      {
        title: "Não some a compra inteira e as parcelas",
        text: "Se o controle mensal já inclui cada parcela, lançar novamente o valor integral como despesa aumenta artificialmente o gasto. Escolha uma forma consistente de registrar e confira a fatura antes de confirmar pagamentos.",
      },
      {
        title: "Olhe os próximos meses antes de comprar",
        text: "Some as parcelas existentes aos gastos fixos e variáveis previstos. A diferença entre receitas previstas e compromissos ajuda a visualizar o mês; ela não garante que gastos imprevistos deixarão de acontecer.",
      },
      {
        title: "Registre no Nossa Conta",
        text: "Ao cadastrar uma despesa parcelada, informe o total e a quantidade de parcelas ou o valor da parcela e a quantidade. Acompanhe os lançamentos nos respectivos meses e confirme os pagamentos quando acontecerem.",
      },
    ],
  },
  "organizar-contas-fixas-e-variaveis": {
    title: "Como organizar contas fixas e variáveis da casa",
    description:
      "Organize aluguel, internet, energia e mercado com recorrências, valores previstos e confirmação dos pagamentos.",
    intro:
      "Uma despesa pode se repetir todo mês e ainda mudar de valor. Separar frequência, previsão e pagamento deixa o acompanhamento mais claro.",
    sections: [
      {
        title: "Liste os compromissos recorrentes",
        text: "Anote aluguel, internet, assinaturas e outras contas frequentes com o vencimento de cada uma. Para energia e água, use uma estimativa até receber a conta e depois ajuste o valor daquele mês.",
      },
      {
        title: "Preveja os gastos do dia a dia",
        text: "Mercado, transporte e lazer podem variar. Consulte meses anteriores e use valores que façam sentido para a rotina atual, lembrando de mudanças de renda, viagens e despesas excepcionais.",
      },
      {
        title: "Confirme o que aconteceu",
        text: "Mantenha o valor previsto enquanto a conta não chega. Depois de conferir o valor real, atualize o registro e marque como pago somente quando o pagamento tiver sido feito.",
      },
      {
        title: "Acompanhe em conjunto",
        text: "No Nossa Conta, as recorrências ajudam a organizar o calendário e podem ter valores ajustados ao longo dos meses. Os participantes acompanham os mesmos registros com identificação de quem pagou.",
      },
    ],
  },
  "planilha-ou-app-financas-casal": {
    title: "Planilha ou app para organizar as finanças do casal?",
    description:
      "Compare a flexibilidade da planilha com o uso compartilhado de um app e escolha uma rotina que funcione para o casal.",
    intro:
      "A ferramenta certa é a que vocês conseguem manter atualizada. Uma planilha pode funcionar muito bem; um app pode facilitar quando os dois precisam participar pelo celular.",
    sections: [
      {
        title: "Quando a planilha funciona bem",
        text: "Ela oferece liberdade para criar colunas, fórmulas e análises. É uma boa opção para quem gosta de montar o próprio controle e mantém uma rotina de conferência. Compartilhar o arquivo exige combinar permissões e evitar versões diferentes.",
      },
      {
        title: "Quando considerar um app",
        text: "Se os registros ficam para depois porque o arquivo é trabalhoso no celular, ou apenas uma pessoa entende as fórmulas, vale testar uma interface pronta. Avaliem parcelas, recorrências e acesso separado para cada participante.",
      },
      {
        title: "Façam um teste com um mês",
        text: "Comecem com as contas atuais e confiram os totais com a ferramenta anterior. Evitem duplicar parcelas e definam uma data para passar a manter apenas um controle principal.",
      },
      {
        title: "O que testar no Nossa Conta",
        text: "Cadastrem uma receita, uma conta recorrente e uma compra parcelada. Depois, convidem a outra pessoa e confiram a visão do mês. Atualmente o cadastro é manual: não há importação de planilha disponível.",
      },
    ],
  },
};
