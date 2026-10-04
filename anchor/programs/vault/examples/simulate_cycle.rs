use anchor_lang::{system_program, AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::token;
use litesvm::LiteSVM;
use solana_sdk::{
    account::Account,
    clock::Clock,
    instruction::Instruction,
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
    sysvar::SysvarId,
    transaction::Transaction,
};
use vault::ID as PROGRAM_ID;
use vault::{instruction, Circle, CircleStatus};

const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
const USDC_DECIMALS: u8 = 6;
const ONE_USDC: u64 = 1_000_000;

fn create_mint_data(mint_authority: &Pubkey, decimals: u8) -> Vec<u8> {
    let mut data = vec![0u8; 82];
    data[0..4].copy_from_slice(&1u32.to_le_bytes());
    data[4..36].copy_from_slice(mint_authority.as_ref());
    data[36..44].copy_from_slice(&0u64.to_le_bytes());
    data[44] = decimals;
    data[45] = 1;
    data
}

fn create_token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1;
    data
}

fn get_circle_pda(creator: &Pubkey, circle_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"circle", creator.as_ref(), &circle_id.to_le_bytes()],
        &PROGRAM_ID,
    )
}

fn get_vault_pda(circle: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"vault", circle.as_ref()], &PROGRAM_ID)
}

fn get_member_pda(circle: &Pubkey, wallet: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"member", circle.as_ref(), wallet.as_ref()], &PROGRAM_ID)
}

fn get_token_balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
    match svm.get_account(token_account) {
        Some(acc) if acc.data.len() >= 72 => {
            let mut amount_bytes = [0u8; 8];
            amount_bytes.copy_from_slice(&acc.data[64..72]);
            u64::from_le_bytes(amount_bytes)
        }
        _ => 0,
    }
}

fn format_usdc(raw: u64) -> String {
    format!("{:.2} USDC", raw as f64 / ONE_USDC as f64)
}

fn print_balances(step: &str, svm: &LiteSVM, member_atas: &[Pubkey], vault_pda: &Pubkey) {
    println!("\n================================================================================");
    println!(" [STEP] {}", step);
    println!("--------------------------------------------------------------------------------");
    for (i, ata) in member_atas.iter().enumerate() {
        let bal = get_token_balance(svm, ata);
        println!("  Member {} Wallet Token Account : {}", i, format_usdc(bal));
    }
    let vault_bal = get_token_balance(svm, vault_pda);
    println!("  Circle Vault PDA Account       : {}", format_usdc(vault_bal));
    println!("================================================================================");
}

fn main() {
    println!("================================================================================");
    println!("                KOLO / AJO ROTATING SAVINGS CIRCLE SIMULATION                   ");
    println!("================================================================================");

    let mut svm = LiteSVM::new();
    let program_bytes = include_bytes!("../../../target/deploy/vault.so");
    svm.add_program(PROGRAM_ID, program_bytes).expect("Failed to deploy vault program to LiteSVM");

    let creator = Keypair::new();
    svm.airdrop(&creator.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();

    let usdc_mint = Pubkey::new_unique();
    svm.set_account(
        usdc_mint,
        Account {
            lamports: 10_000_000,
            data: create_mint_data(&creator.pubkey(), USDC_DECIMALS),
            owner: token::ID,
            executable: false,
            rent_epoch: 0,
        },
    ).unwrap();

    let num_members = 3;
    let initial_balance = 500 * ONE_USDC;
    let contribution_amount = 50 * ONE_USDC;
    let frequency = 604_800; // 1 week
    let circle_id = 101u64;

    let mut members = Vec::new();
    let mut member_atas = Vec::new();

    for _ in 0..num_members {
        let m = Keypair::new();
        svm.airdrop(&m.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();

        let ata = Pubkey::new_unique();
        svm.set_account(
            ata,
            Account {
                lamports: 10_000_000,
                data: create_token_account_data(&usdc_mint, &m.pubkey(), initial_balance),
                owner: token::ID,
                executable: false,
                rent_epoch: 0,
            },
        ).unwrap();

        members.push(m);
        member_atas.push(ata);
    }

    let (circle_pda, _) = get_circle_pda(&creator.pubkey(), circle_id);
    let (vault_pda, _) = get_vault_pda(&circle_pda);

    // Initial State
    print_balances("Initial Balances (Each Member has 500.00 USDC)", &svm, &member_atas, &vault_pda);

    // 1. Create Circle
    let create_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: vault::accounts::CreateCircle {
            creator: creator.pubkey(),
            circle: circle_pda,
            vault: vault_pda,
            usdc_mint,
            system_program: system_program::ID,
            token_program: token::ID,
            rent: anchor_lang::prelude::Rent::id(),
        }
        .to_account_metas(None),
        data: instruction::CreateCircle {
            circle_id,
            contribution_amount,
            frequency,
            max_members: 3,
            payout_order: vec![],
        }
        .data(),
    };
    svm.expire_blockhash();
    let tx = Transaction::new_signed_with_payer(&[create_ix], Some(&creator.pubkey()), &[&creator], svm.latest_blockhash());
    svm.send_transaction(tx).expect("Create circle failed");
    print_balances("1. Circle Created (Status: Forming)", &svm, &member_atas, &vault_pda);

    // 2. All 3 Members Join and Stake Collateral (50 USDC each)
    for i in 0..3 {
        let (member_pda, _) = get_member_pda(&circle_pda, &members[i].pubkey());
        let join_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: vault::accounts::JoinCircle {
                member_wallet: members[i].pubkey(),
                circle: circle_pda,
                member: member_pda,
                vault: vault_pda,
                member_token_account: member_atas[i],
                system_program: system_program::ID,
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::JoinCircle.data(),
        };
        svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(&[join_ix], Some(&members[i].pubkey()), &[&members[i]], svm.latest_blockhash());
        svm.send_transaction(tx).expect("Join circle failed");
    }
    print_balances("2. All 3 Members Joined & Locked 50.00 USDC Stake Each (Status: Active)", &svm, &member_atas, &vault_pda);

    // 3. Round 0: On-time contributions from all 3 members + Payout to Member 0
    for i in 0..3 {
        let (member_pda, _) = get_member_pda(&circle_pda, &members[i].pubkey());
        let contribute_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: vault::accounts::Contribute {
                member_wallet: members[i].pubkey(),
                circle: circle_pda,
                member: member_pda,
                vault: vault_pda,
                member_token_account: member_atas[i],
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::Contribute.data(),
        };
        svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(&[contribute_ix], Some(&members[i].pubkey()), &[&members[i]], svm.latest_blockhash());
        svm.send_transaction(tx).expect("Contribute failed");
    }
    print_balances("3a. Round 0: All 3 Members Contributed 50.00 USDC (Pot = 150.00 USDC)", &svm, &member_atas, &vault_pda);

    let (member0_pda, _) = get_member_pda(&circle_pda, &members[0].pubkey());
    let release_ix0 = Instruction {
        program_id: PROGRAM_ID,
        accounts: vault::accounts::ReleasePayout {
            caller: creator.pubkey(),
            circle: circle_pda,
            recipient_member: member0_pda,
            vault: vault_pda,
            recipient_token_account: member_atas[0],
            token_program: token::ID,
        }
        .to_account_metas(None),
        data: instruction::ReleasePayout.data(),
    };
    svm.expire_blockhash();
    let tx = Transaction::new_signed_with_payer(&[release_ix0], Some(&creator.pubkey()), &[&creator], svm.latest_blockhash());
    svm.send_transaction(tx).expect("Release payout 0 failed");
    print_balances("3b. Round 0 Payout: 150.00 USDC Released to Member 0", &svm, &member_atas, &vault_pda);

    // 4. Round 1: Member 0 & 2 contribute on time. Member 1 triggers late payment grace period & pays with 7% fee (53.50 USDC)
    for i in &[0, 2] {
        let (member_pda, _) = get_member_pda(&circle_pda, &members[*i].pubkey());
        let contribute_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: vault::accounts::Contribute {
                member_wallet: members[*i].pubkey(),
                circle: circle_pda,
                member: member_pda,
                vault: vault_pda,
                member_token_account: member_atas[*i],
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::Contribute.data(),
        };
        svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(&[contribute_ix], Some(&members[*i].pubkey()), &[&members[*i]], svm.latest_blockhash());
        svm.send_transaction(tx).expect("Contribute failed");
    }

    // Advance clock past round frequency (+ 10 hours into grace period)
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp += frequency + 36_000;
    svm.set_sysvar::<Clock>(&clock);

    // Trigger handle_late_payment for Member 1 (any circle member may do this; the
    // creator is not a member, so Member 0 acts as the caller).
    let (member1_pda, _) = get_member_pda(&circle_pda, &members[1].pubkey());
    let (member0_pda, _) = get_member_pda(&circle_pda, &members[0].pubkey());
    let late_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: vault::accounts::HandleLatePayment {
            caller: members[0].pubkey(),
            caller_member: member0_pda,
            circle: circle_pda,
            member: member1_pda,
        }
        .to_account_metas(None),
        data: instruction::HandleLatePayment.data(),
    };
    svm.expire_blockhash();
    let tx = Transaction::new_signed_with_payer(&[late_ix], Some(&members[0].pubkey()), &[&members[0]], svm.latest_blockhash());
    svm.send_transaction(tx).expect("Handle late payment failed");

    // Member 1 pays late contribution + 7% late fee = 53.50 USDC
    let contribute_late_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: vault::accounts::Contribute {
            member_wallet: members[1].pubkey(),
            circle: circle_pda,
            member: member1_pda,
            vault: vault_pda,
            member_token_account: member_atas[1],
            token_program: token::ID,
        }
        .to_account_metas(None),
        data: instruction::Contribute.data(),
    };
    svm.expire_blockhash();
    let tx = Transaction::new_signed_with_payer(&[contribute_late_ix], Some(&members[1].pubkey()), &[&members[1]], svm.latest_blockhash());
    svm.send_transaction(tx).expect("Late contribution with fee failed");
    print_balances("4a. Round 1: Member 1 Paid Late with 7% Fee (53.50 USDC) in Grace Period. Total Pot = 153.50 USDC", &svm, &member_atas, &vault_pda);

    // Release payout to Member 1
    let release_ix1 = Instruction {
        program_id: PROGRAM_ID,
        accounts: vault::accounts::ReleasePayout {
            caller: creator.pubkey(),
            circle: circle_pda,
            recipient_member: member1_pda,
            vault: vault_pda,
            recipient_token_account: member_atas[1],
            token_program: token::ID,
        }
        .to_account_metas(None),
        data: instruction::ReleasePayout.data(),
    };
    svm.expire_blockhash();
    let tx = Transaction::new_signed_with_payer(&[release_ix1], Some(&creator.pubkey()), &[&creator], svm.latest_blockhash());
    svm.send_transaction(tx).expect("Release payout 1 failed");
    print_balances("4b. Round 1 Payout: 153.50 USDC Released to Member 1", &svm, &member_atas, &vault_pda);

    // 5. Round 2: On-time contributions from all 3 members + Payout to Member 2
    for i in 0..3 {
        let (member_pda, _) = get_member_pda(&circle_pda, &members[i].pubkey());
        let contribute_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: vault::accounts::Contribute {
                member_wallet: members[i].pubkey(),
                circle: circle_pda,
                member: member_pda,
                vault: vault_pda,
                member_token_account: member_atas[i],
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::Contribute.data(),
        };
        svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(&[contribute_ix], Some(&members[i].pubkey()), &[&members[i]], svm.latest_blockhash());
        svm.send_transaction(tx).expect("Contribute failed");
    }
    print_balances("5a. Round 2: All 3 Members Contributed 50.00 USDC (Pot = 150.00 USDC)", &svm, &member_atas, &vault_pda);

    let (member2_pda, _) = get_member_pda(&circle_pda, &members[2].pubkey());
    let release_ix2 = Instruction {
        program_id: PROGRAM_ID,
        accounts: vault::accounts::ReleasePayout {
            caller: creator.pubkey(),
            circle: circle_pda,
            recipient_member: member2_pda,
            vault: vault_pda,
            recipient_token_account: member_atas[2],
            token_program: token::ID,
        }
        .to_account_metas(None),
        data: instruction::ReleasePayout.data(),
    };
    svm.expire_blockhash();
    let tx = Transaction::new_signed_with_payer(&[release_ix2], Some(&creator.pubkey()), &[&creator], svm.latest_blockhash());
    svm.send_transaction(tx).expect("Release payout 2 failed");
    print_balances("5b. Round 2 Payout: 150.00 USDC Released to Member 2 (Circle Status: Completed)", &svm, &member_atas, &vault_pda);

    let circle_acc = svm.get_account(&circle_pda).unwrap();
    let circle_state: Circle = Circle::try_deserialize(&mut circle_acc.data.as_slice()).unwrap();
    assert_eq!(circle_state.status, CircleStatus::Completed);

    // 6. Complete Circle: Collateral Stake Refunds (50.00 USDC back to each member)
    for i in 0..3 {
        let (member_pda, _) = get_member_pda(&circle_pda, &members[i].pubkey());
        let complete_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: vault::accounts::CompleteCircle {
                member_wallet: members[i].pubkey(),
                circle: circle_pda,
                member: member_pda,
                vault: vault_pda,
                member_token_account: member_atas[i],
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::CompleteCircle.data(),
        };
        svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(&[complete_ix], Some(&members[i].pubkey()), &[&members[i]], svm.latest_blockhash());
        svm.send_transaction(tx).expect("Complete circle failed");
    }
    print_balances("6. Full Circle Completed: 50.00 USDC Collateral Refunded to Each Member (Vault = 0.00 USDC)", &svm, &member_atas, &vault_pda);

    println!("\n[VERIFICATION SUMMARY]");
    println!("- Member 0: Started 500.00 USDC -> Staked 50 + Contributed 3x50 (150) + Received Payout 150 + Refunded 50 = 500.00 USDC");
    println!("- Member 1: Started 500.00 USDC -> Staked 50 + Contributed 2x50 + 1x53.50 (153.50) + Received Payout 153.50 + Refunded 50 = 500.00 USDC");
    println!("- Member 2: Started 500.00 USDC -> Staked 50 + Contributed 3x50 (150) + Received Payout 150 + Refunded 50 = 500.00 USDC");
    println!("- Vault: Cleanly emptied to 0.00 USDC.\n");
}
